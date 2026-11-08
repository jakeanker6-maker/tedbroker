/**
 * Onboarding wizard: personal info, address, identity verification, investment profile.
 * Classic script. Needs assets/js/auth.js (TED_AUTH) to be loaded first.
 */

const GENERIC_ERROR = 'Something went wrong. Your answers are still here. Try again.';
const QUESTION_REQUIRED = 'Please select an option to continue.';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const QUESTIONNAIRE_FIELDS = ['risk_tolerance', 'annual_income', 'employment_status'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const COUNTRY_NOT_LISTED = 'Choose your country from the list.';

// Country list (ES module). Null if it fails to load: the country check then rejects every value.
const countriesReady = import('./lib/countries.js').catch(() => null);

let uploadedPhoto = null;
let activeReader = null;
let questionnaireView = 1;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    if (!TED_AUTH.isAuthenticated()) {
        window.location.href = '/login';
        return;
    }

    // Check onboarding status
    checkOnboardingStatus();

    // Setup form handlers
    setupPersonalInfoForm();
    setupAddressForm();
    setupKYCForm();
    setupFileUpload();
    setupBackButtons();
    setupQuestionnaireForm();
    setupCompletionDialog();
    setupInlineErrorClearing();
});

/**
 * Check if user has already completed onboarding
 */
async function checkOnboardingStatus() {
    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/status');
        const data = await response.json();

        if (data.is_onboarding_complete) {
            if (data.questionnaire_completed) {
                // Fully onboarded: approved users go to the app, everyone else to the status page
                await goToNextStep();
            } else {
                // KYC done but questionnaire missing: resume it here.
                // Do not call goToNextStep(): the gate would send the user back to /onboarding.
                goToStep(4);
            }
            return;
        }

        // Load existing data if any
        loadExistingData();

    } catch (error) {
        console.error('Error checking onboarding status:', error);
        showFormAlert(document.getElementById('personal-info-form'), 'We could not load your progress. Refresh the page to try again.');
    }
}

/**
 * After onboarding: /app/ when approved, /welcome while ID upload is being approved.
 */
async function goToNextStep() {
    try {
        const { resolvePostAuthPath } = await import('./live/gate.js');
        window.location.href = (await resolvePostAuthPath()) || '/welcome';
    } catch (error) {
        window.location.href = '/welcome';
    }
}

/**
 * Load existing onboarding data
 */
async function loadExistingData() {
    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/data');
        const data = await response.json();

        // Older accounts may hold a 2-letter code (e.g. "US"): show the country name instead
        const countries = await countriesReady;
        const countryName = (value) => countries?.findCountryByCode(value)?.name ?? value ?? '';

        // Load personal info if exists
        if (data.personal_info && data.personal_info.first_name) {
            document.getElementById('first_name').value = data.personal_info.first_name || '';
            document.getElementById('last_name').value = data.personal_info.last_name || '';
            document.getElementById('gender').value = data.personal_info.gender || '';
        } else {
            // For Google OAuth users, try to pre-fill from their profile
            const userData = TED_AUTH.getUser();
            if (userData && userData.full_name) {
                // Split full_name into first and last name
                const nameParts = userData.full_name.trim().split(' ');
                const firstName = nameParts[0] || '';
                const lastName = nameParts.slice(1).join(' ') || '';

                document.getElementById('first_name').value = firstName;
                document.getElementById('last_name').value = lastName;
            }
            if (userData && userData.gender) {
                document.getElementById('gender').value = userData.gender;
            }
        }

        // Load address if exists
        if (data.address && data.address.street) {
            document.getElementById('street').value = data.address.street || '';
            document.getElementById('city').value = data.address.city || '';
            document.getElementById('state').value = data.address.state || '';
            document.getElementById('zip_code').value = data.address.zip_code || '';
            document.getElementById('country').value = countryName(data.address.country);
        } else {
            // Pre-fill country from user profile if available
            const userData = TED_AUTH.getUser();
            if (userData && userData.country) {
                document.getElementById('country').value = countryName(userData.country);
            }
        }

        // Load KYC if exists
        if (data.kyc && data.kyc.document_number) {
            document.getElementById('document_number').value = data.kyc.document_number || '';
        }

    } catch (error) {
        console.error('Error loading existing data:', error);
    }
}

/* ==================================================================
   Shared helpers (DOM only: no innerHTML with data)
   ================================================================== */

/** Polite status text for screen readers while a request runs */
function setStatus(message) {
    document.getElementById('onb-status').textContent = message;
}

/** Success toast in the shared .toast-region */
function showToast(message) {
    const region = document.querySelector('.toast-region');
    if (!region) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    const icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    icon.append(path);

    const label = document.createElement('span');
    label.textContent = message;

    toast.append(icon, label);
    region.append(toast);

    setTimeout(() => {
        toast.dataset.leaving = '';
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2600);
}

/** Error from a server response. The message is shown as-is; only string details are used. */
function serverError(data) {
    const message = typeof data?.detail === 'string' && data.detail ? data.detail : GENERIC_ERROR;
    const error = new Error(message);
    error.handled = true;
    return error;
}

/** Inline field error: .field__error with the control's id plus "-error" */
function showFieldError(control, message) {
    const field = control.closest('.field');
    document.getElementById(`${control.id}-error`).querySelector('[data-error-msg]').textContent = message;
    control.setAttribute('aria-invalid', 'true');
    field.dataset.invalid = 'true';
}

function clearFieldError(control) {
    const field = control.closest('.field');
    document.getElementById(`${control.id}-error`).querySelector('[data-error-msg]').textContent = '';
    control.removeAttribute('aria-invalid');
    delete field.dataset.invalid;
}

/** Clear the error as soon as a text field or select is changed */
function setupInlineErrorClearing() {
    const clearIfInvalid = (e) => {
        const control = e.target;
        if (control.matches('.field__input, .field__select') && control.hasAttribute('aria-invalid')) {
            clearFieldError(control);
        }
    };
    document.addEventListener('input', clearIfInvalid);
    document.addEventListener('change', clearIfInvalid);
}

/** Form-level error line (.onb-alert) above the action row */
function showFormAlert(form, message) {
    const alert = form.querySelector('.onb-alert');
    alert.querySelector('[data-error-msg]').textContent = message;
    alert.hidden = false;
    // Focus moves to the message, because the busy submit button lost focus when it was disabled
    alert.tabIndex = -1;
    alert.focus({ preventScroll: true });
}

function clearFormAlert(form) {
    const alert = form.querySelector('.onb-alert');
    alert.hidden = true;
    alert.querySelector('[data-error-msg]').textContent = '';
}

/** Busy state: disable the form's controls and mark the submit button aria-busy */
function setFormBusy(form, busy) {
    const submit = form.querySelector('[type="submit"]');
    form.querySelectorAll('button, input, select').forEach(control => {
        control.disabled = busy;
    });
    if (submit) {
        if (busy) {
            submit.setAttribute('aria-busy', 'true');
        } else {
            submit.removeAttribute('aria-busy');
        }
    }
}

/**
 * Required-field validation. Shows inline errors, focuses the first invalid control.
 * @returns {boolean} true when at least one field is invalid
 */
function validateRequired(fields) {
    let firstInvalid = null;
    fields.forEach(({ id, message, isListed }) => {
        const control = document.getElementById(id);
        const value = control.value.trim();
        if (value && (!isListed || isListed(value))) {
            clearFieldError(control);
            return;
        }
        // A typed value that is not in the country list gets its own message
        showFieldError(control, (value && isListed) ? COUNTRY_NOT_LISTED : message);
        firstInvalid = firstInvalid || control;
    });
    if (firstInvalid) {
        firstInvalid.focus();
    }
    return firstInvalid !== null;
}

/** POST one wizard step and move on when it is saved */
async function submitStep({ form, endpoint, payload, busyMessage, successMessage, onSuccess }) {
    clearFormAlert(form);
    setFormBusy(form, true);
    setStatus(busyMessage);

    try {
        const response = await TED_AUTH.apiCall(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw serverError(data);
        }

        setStatus('');
        const finish = () => {
            setFormBusy(form, false);
            onSuccess();
        };
        if (successMessage) {
            showToast(successMessage);
            setTimeout(finish, 500);
        } else {
            finish();
        }

    } catch (error) {
        setStatus('');
        setFormBusy(form, false);
        showFormAlert(form, error.handled ? error.message : GENERIC_ERROR);
    }
}

/* ==================================================================
   Step 1: personal information
   ================================================================== */
function setupPersonalInfoForm() {
    const form = document.getElementById('personal-info-form');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        clearFormAlert(form);

        if (validateRequired([
            { id: 'first_name', message: 'Enter your first name.' },
            { id: 'last_name', message: 'Enter your last name.' },
            { id: 'gender', message: 'Select your gender.' }
        ])) {
            return;
        }

        submitStep({
            form,
            endpoint: '/api/onboarding/personal-info',
            payload: {
                first_name: document.getElementById('first_name').value.trim(),
                last_name: document.getElementById('last_name').value.trim(),
                gender: document.getElementById('gender').value
            },
            busyMessage: 'Saving personal information...',
            successMessage: 'Personal information saved!',
            onSuccess: () => goToStep(2)
        });
    });
}

/* ==================================================================
   Step 2: address
   ================================================================== */
function setupAddressForm() {
    const form = document.getElementById('address-form');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearFormAlert(form);

        const countries = await countriesReady;
        const isListed = (value) => Boolean(countries?.findCountryByName(value));

        if (validateRequired([
            { id: 'street', message: 'Enter your street address.' },
            { id: 'city', message: 'Enter your city.' },
            { id: 'state', message: 'Enter your state or province.' },
            { id: 'zip_code', message: 'Enter your ZIP or postal code.' },
            { id: 'country', message: 'Enter your country.', isListed }
        ])) {
            return;
        }

        // Store the list's canonical name, whatever the casing the user typed
        const country = countries.findCountryByName(document.getElementById('country').value).name;

        submitStep({
            form,
            endpoint: '/api/onboarding/address',
            payload: {
                street: document.getElementById('street').value.trim(),
                city: document.getElementById('city').value.trim(),
                state: document.getElementById('state').value.trim(),
                zip_code: document.getElementById('zip_code').value.trim(),
                country
            },
            busyMessage: 'Saving address information...',
            successMessage: 'Address information saved!',
            onSuccess: () => goToStep(3)
        });
    });
}

/* ==================================================================
   Step 3: identity verification
   ================================================================== */
function setupKYCForm() {
    const form = document.getElementById('kyc-form');
    const photoInput = document.getElementById('document_photo');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        clearFormAlert(form);

        const numberInvalid = validateRequired([
            { id: 'document_number', message: 'Enter your document number.' }
        ]);

        if (!uploadedPhoto) {
            showFieldError(photoInput, 'Upload a photo of your ID document.');
            if (!numberInvalid) {
                photoInput.focus();
            }
        }

        if (numberInvalid || !uploadedPhoto) {
            return;
        }

        submitStep({
            form,
            endpoint: '/api/onboarding/kyc',
            payload: {
                document_number: document.getElementById('document_number').value.trim(),
                document_photo: uploadedPhoto
            },
            busyMessage: 'Submitting verification documents...',
            successMessage: null,
            // KYC saved: continue with the investment questionnaire
            onSuccess: () => goToStep(4)
        });
    });
}

/* ==================================================================
   Step 4: investment questionnaire (three views, submitted once)
   ================================================================== */
function setupQuestionnaireForm() {
    const form = document.getElementById('questionnaire-form');

    // Next/Back buttons use data-q-action; one delegated listener covers all views
    form.addEventListener('click', function(e) {
        const button = e.target.closest('button[data-q-action]');
        if (!button || !form.contains(button)) {
            return;
        }

        if (button.dataset.qAction === 'next') {
            questionnaireNext();
        } else {
            questionnaireBack();
        }
    });

    form.addEventListener('submit', submitQuestionnaire);
}

/**
 * Whether a radio group of the questionnaire has a selection
 */
function isQuestionAnswered(fieldName) {
    return document.querySelector(`input[name="${fieldName}"]:checked`) !== null;
}

/**
 * Show or clear the inline validation message of one questionnaire view
 */
function setQuestionnaireError(view, message) {
    const errorEl = document.getElementById(`q-error-${view}`);
    errorEl.querySelector('[data-error-text]').textContent = message || '';
    errorEl.hidden = !message;
}

/**
 * Show one questionnaire view (1-3), update progress dots and the position text.
 * Focus moves to the question heading unless the caller is entering step 4 (then the step h1 has focus).
 */
function showQuestionnaireView(view, { focus = true } = {}) {
    setQuestionnaireError(questionnaireView, '');
    questionnaireView = view;

    document.querySelectorAll('.questionnaire-view').forEach(section => {
        section.hidden = Number(section.dataset.view) !== view;
    });

    document.querySelectorAll('.questionnaire-dot').forEach(dot => {
        const dotNumber = Number(dot.dataset.dot);
        dot.classList.toggle('is-active', dotNumber === view);
        dot.classList.toggle('is-done', dotNumber < view);
    });

    document.getElementById('questionnaire-position').textContent = `Question ${view} of ${QUESTIONNAIRE_FIELDS.length}`;

    if (focus) {
        document.getElementById(`q-heading-${view}`).focus({ preventScroll: true });
    }
}

/**
 * Go to the next questionnaire view, requiring a selection on the current one
 */
function questionnaireNext() {
    if (!isQuestionAnswered(QUESTIONNAIRE_FIELDS[questionnaireView - 1])) {
        setQuestionnaireError(questionnaireView, QUESTION_REQUIRED);
        return;
    }

    showQuestionnaireView(questionnaireView + 1);
}

/**
 * Go to the previous questionnaire view; from view 1 return to step 3
 */
function questionnaireBack() {
    if (questionnaireView === 1) {
        goToStep(3);
        return;
    }

    showQuestionnaireView(questionnaireView - 1);
}

/**
 * Submit the investment questionnaire (view 3 only)
 */
async function submitQuestionnaire(e) {
    e.preventDefault();

    // Submit is only reachable from view 3; ignore any other submit
    if (questionnaireView < QUESTIONNAIRE_FIELDS.length) {
        return;
    }

    const form = e.currentTarget;
    clearFormAlert(form);

    // Make sure every question is answered; jump to the first unanswered one
    const missingView = QUESTIONNAIRE_FIELDS.findIndex(field => !isQuestionAnswered(field));
    if (missingView !== -1) {
        showQuestionnaireView(missingView + 1);
        setQuestionnaireError(missingView + 1, QUESTION_REQUIRED);
        return;
    }

    setQuestionnaireError(questionnaireView, '');

    const payload = {};
    QUESTIONNAIRE_FIELDS.forEach(field => {
        payload[field] = document.querySelector(`input[name="${field}"]:checked`).value;
    });

    setFormBusy(form, true);
    setStatus('Saving your investment profile...');

    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/questionnaire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw serverError(data);
        }

        setStatus('');
        // Controls stay disabled: the user leaves this page through the dialog
        openCompletionDialog();

    } catch (error) {
        setStatus('');
        setFormBusy(form, false);
        showFormAlert(form, error.handled ? error.message : GENERIC_ERROR);
    }
}

/* ==================================================================
   Completion dialog (native <dialog>, no Escape or backdrop dismissal)
   ================================================================== */
function setupCompletionDialog() {
    const dialog = document.getElementById('onb-complete');

    dialog.addEventListener('cancel', function(e) {
        e.preventDefault();
    });

    document.getElementById('onb-complete-continue').addEventListener('click', function() {
        goToNextStep();
    });
}

function openCompletionDialog() {
    const dialog = document.getElementById('onb-complete');
    if (!dialog.open) {
        dialog.showModal();
    }
    document.getElementById('onb-complete-continue').focus();
}

/* ==================================================================
   Identity document: dropzone, preview, drag and drop
   ================================================================== */
function setupFileUpload() {
    const fileInput = document.getElementById('document_photo');
    const fileLabel = document.getElementById('file-upload-label');
    const filePreview = document.getElementById('file-preview');
    const previewImage = document.getElementById('preview-image');
    const previewFail = document.getElementById('preview-error');
    const changePhotoBtn = document.getElementById('change-photo');

    // Dropzone and preview are never shown together
    function showPreview(show) {
        fileLabel.hidden = show;
        filePreview.hidden = !show;
    }

    // "Reading photo..." replaces the dropzone title while the file is read
    function setReading(reading) {
        if (reading) {
            fileLabel.setAttribute('aria-busy', 'true');
            setStatus('Reading photo...');
        } else {
            fileLabel.removeAttribute('aria-busy');
            setStatus('');
        }
        fileLabel.querySelector('.onb-dropzone__title').hidden = reading;
        fileLabel.querySelector('.onb-dropzone__reading').hidden = !reading;
    }

    // Handle file selection
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];

        if (!file) {
            return;
        }

        // Validate file type (the copy promises PNG or JPG)
        if (!['image/png', 'image/jpeg'].includes(file.type)) {
            showFieldError(fileInput, 'Choose an image file, such as PNG or JPG.');
            fileInput.value = '';
            return;
        }

        // Validate file size (5MB max)
        if (file.size > MAX_PHOTO_BYTES) {
            showFieldError(fileInput, 'The file must be smaller than 5 MB.');
            fileInput.value = '';
            return;
        }

        clearFieldError(fileInput);
        setReading(true);

        // A new selection cancels any read still in progress, so an older file cannot win
        if (activeReader) {
            activeReader.abort();
        }

        // Read file as base64
        const reader = new FileReader();
        activeReader = reader;
        reader.onload = function(event) {
            uploadedPhoto = event.target.result;
            previewFail.hidden = true;
            previewImage.hidden = false;
            previewImage.src = uploadedPhoto;
            setReading(false);
            showPreview(true);
        };
        reader.onerror = function() {
            setReading(false);
            showFieldError(fileInput, GENERIC_ERROR);
            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    // A preview that cannot be decoded keeps "Change photo" available
    previewImage.addEventListener('error', function() {
        previewImage.hidden = true;
        previewFail.hidden = false;
    });

    // Handle change photo button: reset and return focus to the file input
    changePhotoBtn.addEventListener('click', function() {
        fileInput.value = '';
        uploadedPhoto = null;
        previewImage.removeAttribute('src');
        previewImage.hidden = false;
        previewFail.hidden = true;
        showPreview(false);
        fileInput.focus();
    });

    // Handle drag and drop
    fileLabel.addEventListener('dragover', function(e) {
        e.preventDefault();
        fileLabel.classList.add('is-dragover');
    });

    fileLabel.addEventListener('dragleave', function(e) {
        e.preventDefault();
        fileLabel.classList.remove('is-dragover');
    });

    fileLabel.addEventListener('drop', function(e) {
        e.preventDefault();
        fileLabel.classList.remove('is-dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event('change'));
        }
    });
}

/* ==================================================================
   Navigation
   ================================================================== */
function setupBackButtons() {
    document.getElementById('btn-back-address').addEventListener('click', function() {
        goToStep(1);
    });

    document.getElementById('btn-back-kyc').addEventListener('click', function() {
        goToStep(2);
    });
}

/**
 * Navigate to a specific step. Moves focus to the new step's h1 (spec 9.2 item 1).
 */
function goToStep(step) {
    // Hide all step contents
    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
    });

    // Show target step content
    const targetContent = document.querySelector(`.step-content[data-step="${step}"]`);
    if (targetContent) {
        targetContent.classList.add('active');
    }

    // Update step indicators
    document.querySelectorAll('.wizard-step').forEach((stepElement, index) => {
        const stepNumber = index + 1;

        stepElement.classList.remove('active', 'completed');
        stepElement.removeAttribute('aria-current');

        if (stepNumber < step) {
            stepElement.classList.add('completed');
        } else if (stepNumber === step) {
            stepElement.classList.add('active');
            stepElement.setAttribute('aria-current', 'step');
        }
    });

    // Update current step

    // Entering the questionnaire always starts at its first question (no heading focus: the step h1 takes it)
    if (step === 4) {
        showQuestionnaireView(1, { focus: false });
    }

    // Update progress indicator
    document.getElementById('current-step').textContent = step;

    // Scroll to top (instant when the user prefers reduced motion)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });

    // Announce the new step: focus its heading without scrolling
    const heading = targetContent?.querySelector('h1');
    if (heading) {
        heading.focus({ preventScroll: true });
    }
}
