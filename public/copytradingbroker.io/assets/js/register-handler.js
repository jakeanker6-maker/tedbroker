/**
 * Registration Form Handler
 */

// Google Sign-In Handler
function signInWithGoogle() {
    // Redirect to Google OAuth endpoint
    window.location.href = '/api/auth/google/login';
}

// Handle token from OAuth redirect
async function handleOAuthRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const error = urlParams.get('error');

    if (error) {
        if (error === 'oauth_failed') {
            TED_AUTH.showFormMessage('register-message', 'Google sign-up failed. Please try again.', 'error');
        }
        // Remove error from URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (token) {
        // Save token
        TED_AUTH.saveToken(token);

        // Fetch user data
        await TED_AUTH.fetchCurrentUser();

        // Remove token from URL
        window.history.replaceState({}, document.title, window.location.pathname);

        // Show success and redirect to dashboard
        TED_AUTH.showFormMessage('register-message', 'Registration successful! Redirecting...', 'success');
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 1000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Check for OAuth redirect
    handleOAuthRedirect();
    // Redirect if already logged in
    TED_AUTH.redirectIfAuthenticated();

    // Get the registration form
    const registerForm = document.getElementById('register-form') || document.querySelector('form[action*="register"]');

    if (!registerForm) {
        console.error('Registration form not found');
        return;
    }

    console.log('Register form found, attaching event listener');

    // Prevent default form submission
    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Get form values
        const fullName = document.querySelector('input[name="name"]').value;
        const username = document.querySelector('input[name="username"]').value;
        const email = document.querySelector('input[name="email"]').value;
        const phone = document.querySelector('input[name="phone"]').value;
        const gender = document.querySelector('select[name="gender"]').value;
        const country = document.querySelector('select[name="country"]').value;
        const password = document.querySelector('input[name="password"]').value;
        const passwordConfirmation = document.querySelector('input[name="password_confirmation"]').value;

        // Get account types (multiple select)
        const accountSelect = document.querySelector('select[name="account[]"]');
        const accountTypes = Array.from(accountSelect.selectedOptions).map(option => option.value);

        // Validate inputs
        if (!email || !username || !password) {
            TED_AUTH.showFormMessage('register-message', 'Please fill in all required fields', 'error');
            return;
        }

        // Validate password match
        if (password !== passwordConfirmation) {
            TED_AUTH.showFormMessage('register-message', 'Passwords do not match', 'error');
            return;
        }

        // Validate password strength
        if (password.length < 8) {
            TED_AUTH.showFormMessage('register-message', 'Password must be at least 8 characters long', 'error');
            return;
        }

        if (!/[A-Z]/.test(password)) {
            TED_AUTH.showFormMessage('register-message', 'Password must contain at least one uppercase letter', 'error');
            return;
        }

        if (!/[a-z]/.test(password)) {
            TED_AUTH.showFormMessage('register-message', 'Password must contain at least one lowercase letter', 'error');
            return;
        }

        if (!/[0-9]/.test(password)) {
            TED_AUTH.showFormMessage('register-message', 'Password must contain at least one number', 'error');
            return;
        }

        // Prepare user data
        const userData = {
            email: email,
            username: username,
            password: password,
            full_name: fullName || null,
            phone: phone || null,
            gender: gender || null,
            country: country || null,
            account_types: accountTypes.length > 0 ? accountTypes : null
        };

        // Clear previous messages
        TED_AUTH.clearFormMessage('register-message');

        // Set button to loading state
        TED_AUTH.setButtonLoading('register-btn', 'Register');

        // Call register API
        const result = await TED_AUTH.register(userData);

        // Reset button
        TED_AUTH.resetButton('register-btn', 'Register');

        if (result.success) {
            if (result.data.requires_2fa) {
                // Redirect to 2FA verification page
                TED_AUTH.showFormMessage('register-message', 'Registration successful! Please verify your email.', 'success');
                setTimeout(() => {
                    window.location.href = `/verify-2fa?email=${encodeURIComponent(result.data.email)}`;
                }, 1500);
            } else {
                TED_AUTH.showFormMessage('register-message', 'Registration successful! Redirecting to login...', 'success');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            }
        } else {
            TED_AUTH.showFormMessage('register-message', result.error, 'error');
        }
    });
});
