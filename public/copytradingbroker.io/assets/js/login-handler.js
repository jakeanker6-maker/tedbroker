/**
 * Login Form Handler
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
            TED_AUTH.showFormMessage('login-message', 'Google sign-in failed. Please try again.', 'error');
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

        // Check if onboarding is complete
        try {
            const onboardingResponse = await TED_AUTH.apiCall('/api/onboarding/status');
            const onboardingData = await onboardingResponse.json();

            if (onboardingData.is_onboarding_complete) {
                // Onboarding complete, go to dashboard
                TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting to dashboard...', 'success');
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 1000);
            } else {
                // Onboarding not complete, go to onboarding wizard
                TED_AUTH.showFormMessage('login-message', 'Login successful! Please complete your profile...', 'success');
                setTimeout(() => {
                    window.location.href = '/onboarding';
                }, 1000);
            }
        } catch (error) {
            // If there's an error checking onboarding status, default to dashboard
            console.error('Error checking onboarding status:', error);
            TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Check for OAuth redirect
    handleOAuthRedirect();
    // Redirect if already logged in
    TED_AUTH.redirectIfAuthenticated();

    // Get the login form
    const loginForm = document.getElementById('login-form') || document.querySelector('form[action*="login"]');

    if (!loginForm) {
        console.error('Login form not found');
        return;
    }

    console.log('Login form found, attaching event listener');

    // Prevent default form submission
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Get form values
        const email = document.querySelector('input[name="email"]').value;
        const password = document.querySelector('input[name="password"]').value;

        // Validate inputs
        if (!email || !password) {
            TED_AUTH.showFormMessage('login-message', 'Please enter both email and password', 'error');
            return;
        }

        // Clear previous messages
        TED_AUTH.clearFormMessage('login-message');

        // Set button to loading state
        TED_AUTH.setButtonLoading('login-btn', 'Sign In');

        // Call login API
        const result = await TED_AUTH.login(email, password);

        // Reset button
        TED_AUTH.resetButton('login-btn', 'Sign In');

        if (result.success) {
            if (result.data.requires_2fa) {
                // Store code for fallback display if email failed
                if (result.data.email_sent === false && result.data.code) {
                    localStorage.setItem('pending_verification_code', result.data.code);
                }
                // Redirect to 2FA verification page
                TED_AUTH.showFormMessage('login-message', 'Verification code sent! Redirecting...', 'info');
                setTimeout(() => {
                    window.location.href = `/verify-2fa?email=${encodeURIComponent(result.data.email)}`;
                }, 1500);
            } else {
                // No 2FA required - check onboarding status before redirecting
                try {
                    const onboardingResponse = await TED_AUTH.apiCall('/api/onboarding/status');
                    const onboardingData = await onboardingResponse.json();

                    if (onboardingData.is_onboarding_complete) {
                        // Onboarding complete, go to dashboard
                        TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting to dashboard...', 'success');
                        setTimeout(() => {
                            window.location.href = '/dashboard';
                        }, 1000);
                    } else {
                        // Onboarding not complete, go to onboarding wizard
                        TED_AUTH.showFormMessage('login-message', 'Login successful! Please complete your profile...', 'success');
                        setTimeout(() => {
                            window.location.href = '/onboarding';
                        }, 1000);
                    }
                } catch (error) {
                    // If there's an error checking onboarding status, default to dashboard
                    console.error('Error checking onboarding status:', error);
                    TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = '/dashboard';
                    }, 1000);
                }
            }
        } else {
            TED_AUTH.showFormMessage('login-message', result.error, 'error');
        }
    });
});
