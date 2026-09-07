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
    let token = null;
    let error = null;

    const hash = window.location.hash;
    if (hash && hash.includes('token=')) {
        const hashParams = new URLSearchParams(hash.substring(1));
        token = hashParams.get('token');
        error = hashParams.get('error');
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        token = urlParams.get('token');
        error = urlParams.get('error');
    }

    if (error) {
        if (error === 'oauth_failed') {
            TED_AUTH.showFormMessage('login-message', 'Google sign-in failed. Please try again.', 'error');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (token) {
        TED_AUTH.saveToken(token);
        await TED_AUTH.fetchCurrentUser();
        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            const onboardingResponse = await TED_AUTH.apiCall('/api/onboarding/status');
            const onboardingData = await onboardingResponse.json();

            if (onboardingData.is_onboarding_complete) {
                TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting to dashboard...', 'success');
                setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
            } else {
                TED_AUTH.showFormMessage('login-message', 'Login successful! Please complete your profile...', 'success');
                setTimeout(() => { window.location.href = '/onboarding'; }, 1000);
            }
        } catch (error) {
            console.error('Error checking onboarding status:', error);
            TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting...', 'success');
            setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
        }
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    // Check for OAuth redirect first (await to prevent race condition)
    await handleOAuthRedirect();

    // Only redirect if already logged in AND no token was just processed
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    const hasToken = (hash && hash.includes('token=')) || urlParams.get('token');

    if (!hasToken) {
        TED_AUTH.redirectIfAuthenticated();
    }

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

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            TED_AUTH.showFormMessage('login-message', 'Please enter a valid email address', 'error');
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
                // Redirect to 2FA verification page
                if (result.data.email_sent === false) {
                    TED_AUTH.showFormMessage('login-message', 'Email delivery failed. Please contact support if you do not receive the code.', 'info');
                } else {
                    TED_AUTH.showFormMessage('login-message', 'Verification code sent! Redirecting...', 'info');
                }
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
