/**
 * Onboarding Wizard Handler
 */

let currentStep = 1;
let uploadedPhoto = null;

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
            document.getElementById('country').value = data.address.country || '';
        } else {
            // Pre-fill country from user profile if available
            const userData = TED_AUTH.getUser();
            if (userData && userData.country) {
                document.getElementById('country').value = userData.country;
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

/**
 * Setup Personal Info Form
 */
function setupPersonalInfoForm() {
    const form = document.getElementById('personal-info-form');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = {
            first_name: document.getElementById('first_name').value.trim(),
            last_name: document.getElementById('last_name').value.trim(),
            gender: document.getElementById('gender').value
        };

        // Validate
        if (!formData.first_name || !formData.last_name || !formData.gender) {
            TED_AUTH.showError('Please fill in all required fields');
            return;
        }

        // Submit
        TED_AUTH.showLoading('Saving personal information...');

        try {
            const response = await TED_AUTH.apiCall('/api/onboarding/personal-info', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            const data = await response.json();
            TED_AUTH.closeLoading();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to save personal information');
            }

            TED_AUTH.showSuccess('Personal information saved!');
            setTimeout(() => {
                goToStep(2);
            }, 500);

        } catch (error) {
            TED_AUTH.closeLoading();
            TED_AUTH.showError(error.message);
        }
    });
}

/**
 * Setup Address Form
 */
function setupAddressForm() {
    const form = document.getElementById('address-form');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = {
            street: document.getElementById('street').value.trim(),
            city: document.getElementById('city').value.trim(),
            state: document.getElementById('state').value.trim(),
            zip_code: document.getElementById('zip_code').value.trim(),
            country: document.getElementById('country').value.trim()
        };

        // Validate
        if (!formData.street || !formData.city || !formData.state || !formData.zip_code || !formData.country) {
            TED_AUTH.showError('Please fill in all required fields');
            return;
        }

        // Submit
        TED_AUTH.showLoading('Saving address information...');

        try {
            const response = await TED_AUTH.apiCall('/api/onboarding/address', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            const data = await response.json();
            TED_AUTH.closeLoading();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to save address information');
            }

            TED_AUTH.showSuccess('Address information saved!');
            setTimeout(() => {
                goToStep(3);
            }, 500);

        } catch (error) {
            TED_AUTH.closeLoading();
            TED_AUTH.showError(error.message);
        }
    });
}

/**
 * Setup KYC Form
 */
function setupKYCForm() {
    const form = document.getElementById('kyc-form');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const documentNumber = document.getElementById('document_number').value.trim();

        // Validate
        if (!documentNumber) {
            TED_AUTH.showError('Please enter your document number');
            return;
        }

        if (!uploadedPhoto) {
            TED_AUTH.showError('Please upload a photo of your ID document');
            return;
        }

        const formData = {
            document_number: documentNumber,
            document_photo: uploadedPhoto
        };

        // Submit
        TED_AUTH.showLoading('Submitting verification documents...');

        try {
            const response = await TED_AUTH.apiCall('/api/onboarding/kyc', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            const data = await response.json();
            TED_AUTH.closeLoading();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to submit KYC documents');
            }

            // KYC saved: continue with the investment questionnaire
            goToStep(4);

        } catch (error) {
            TED_AUTH.closeLoading();
            TED_AUTH.showError(error.message);
        }
    });
}

/**
 * Setup Investment Questionnaire (step 4)
 */
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
 * Questionnaire fields, in view order (view N uses QUESTIONNAIRE_FIELDS[N - 1])
 */
const QUESTIONNAIRE_FIELDS = ['risk_tolerance', 'annual_income', 'employment_status'];
let questionnaireView = 1;

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
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
}

/**
 * Show one questionnaire view (1-3), update progress dots and screen-reader text
 */
function showQuestionnaireView(view) {
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

    // Move focus to the new question so keyboard and screen reader users land on it
    document.getElementById(`q-heading-${view}`).focus({ preventScroll: true });
}

/**
 * Go to the next questionnaire view, requiring a selection on the current one
 */
function questionnaireNext() {
    if (!isQuestionAnswered(QUESTIONNAIRE_FIELDS[questionnaireView - 1])) {
        setQuestionnaireError(questionnaireView, 'Please select an option to continue.');
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

    // Make sure every question is answered; jump to the first unanswered one
    const missingView = QUESTIONNAIRE_FIELDS.findIndex(field => !isQuestionAnswered(field));
    if (missingView !== -1) {
        showQuestionnaireView(missingView + 1);
        setQuestionnaireError(missingView + 1, 'Please select an option to continue.');
        return;
    }

    setQuestionnaireError(questionnaireView, '');

    const payload = {};
    QUESTIONNAIRE_FIELDS.forEach(field => {
        payload[field] = document.querySelector(`input[name="${field}"]:checked`).value;
    });

    const submitButton = document.getElementById('questionnaire-submit');
    const navButtons = document.querySelectorAll('#questionnaire-form [data-q-action]');
    submitButton.disabled = true;
    navButtons.forEach(button => { button.disabled = true; });
    TED_AUTH.showLoading('Saving your investment profile...');

    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/questionnaire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        TED_AUTH.closeLoading();

        if (!response.ok) {
            throw new Error(typeof data.detail === 'string' ? data.detail : 'Failed to save questionnaire.');
        }

        // Buttons stay disabled: the user is leaving this page
        Swal.fire({
            title: 'Verification Submitted!',
            html: `
                <div style="text-align: center;">
                    <i class="fas fa-clock" style="color: #ff9800; font-size: 64px; margin-bottom: 20px;"></i>
                    <p style="font-size: 18px; font-weight: bold; color: #2d3748; margin-bottom: 16px;">
                        Thank you for completing your investment profile!
                    </p>
                    <p style="font-size: 16px; margin-bottom: 12px; color: #4a5568; line-height: 1.6;">
                        Your information is currently under review by our team.
                    </p>
                    <div style="background: #fff3cd; padding: 16px; border-radius: 8px; border-left: 4px solid #ff9800; margin: 20px 0;">
                        <p style="font-size: 15px; color: #856404; margin: 0; font-weight: 600;">
                            <i class="fas fa-info-circle"></i> Approval typically takes less than 24 hours
                        </p>
                    </div>
                    <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">
                        You will receive a notification once your account has been approved and you can start trading.
                    </p>
                </div>
            `,
            icon: 'info',
            confirmButtonText: 'Continue',
            confirmButtonColor: '#D32F2F',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then(() => goToNextStep());

    } catch (error) {
        TED_AUTH.closeLoading();
        submitButton.disabled = false;
        navButtons.forEach(button => { button.disabled = false; });
        TED_AUTH.showError(error.message);
    }
}

/**
 * Setup File Upload
 */
function setupFileUpload() {
    const fileInput = document.getElementById('document_photo');
    const fileLabel = document.getElementById('file-upload-label');
    const filePreview = document.getElementById('file-preview');
    const previewImage = document.getElementById('preview-image');
    const changePhotoBtn = document.getElementById('change-photo');

    // Handle file selection
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];

        if (!file) {
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            TED_AUTH.showError('Please select an image file');
            fileInput.value = '';
            return;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            TED_AUTH.showError('File size must be less than 5MB');
            fileInput.value = '';
            return;
        }

        // Read file as base64
        const reader = new FileReader();
        reader.onload = function(event) {
            uploadedPhoto = event.target.result;

            // Show preview
            previewImage.src = uploadedPhoto;
            fileLabel.style.display = 'none';
            filePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    });

    // Handle change photo button
    changePhotoBtn.addEventListener('click', function() {
        fileInput.value = '';
        uploadedPhoto = null;
        fileLabel.style.display = 'block';
        filePreview.style.display = 'none';
    });

    // Handle drag and drop
    fileLabel.addEventListener('dragover', function(e) {
        e.preventDefault();
        fileLabel.style.background = '#FED7D7';
    });

    fileLabel.addEventListener('dragleave', function(e) {
        e.preventDefault();
        fileLabel.style.background = '#FFF5F5';
    });

    fileLabel.addEventListener('drop', function(e) {
        e.preventDefault();
        fileLabel.style.background = '#FFF5F5';

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event('change'));
        }
    });
}

/**
 * Setup Back Buttons
 */
function setupBackButtons() {
    document.getElementById('btn-back-address').addEventListener('click', function() {
        goToStep(1);
    });

    document.getElementById('btn-back-kyc').addEventListener('click', function() {
        goToStep(2);
    });
}

/**
 * Navigate to a specific step
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
    currentStep = step;

    // Entering the questionnaire always starts at its first question
    if (step === 4) {
        showQuestionnaireView(1);
    }

    // Update progress indicator
    if (step <= 4) {
        document.getElementById('current-step').textContent = step;
        document.getElementById('progress-indicator').style.display = 'block';
    } else {
        document.getElementById('progress-indicator').style.display = 'none';
    }

    // Scroll to top (instant when the user prefers reduced motion)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}
