/**
 * TED Broker Authentication Utility
 * Handles user authentication, token management, and API calls
 */

const TED_AUTH = {
    // API Base URL
    API_BASE: window.location.origin,

    // Token storage keys
    TOKEN_KEY: 'ted_access_token',
    USER_KEY: 'ted_user_data',

    /**
     * Save authentication token to localStorage
     */
    saveToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    /**
     * Get authentication token from localStorage
     */
    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    /**
     * Remove authentication token
     */
    removeToken() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
    },

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!localStorage.getItem(this.TOKEN_KEY);
    },

    /**
     * Save user data to localStorage
     */
    saveUser(userData) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(userData));
    },

    /**
     * Get user data from localStorage
     */
    getUser() {
        const userData = localStorage.getItem(this.USER_KEY);
        return userData ? JSON.parse(userData) : null;
    },

    /**
     * Make authenticated API request
     */
    async apiCall(endpoint, options = {}) {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token && !options.skipAuth) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${this.API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        // Handle authentication errors - redirect to login if token is invalid
        if (response.status === 401 || response.status === 403) {
            // Check if we're not already on a login/register page to prevent redirect loops
            const currentPath = window.location.pathname;
            const isAuthPage = currentPath.includes('/login') ||
                              currentPath.includes('/register') ||
                              currentPath.includes('/forgot-password');

            if (!isAuthPage) {
                // Clear stored authentication data
                this.removeToken();

                // Show error message
                this.showError('Your session has expired. Please login again.');

                // Redirect to login page after a short delay
                setTimeout(() => {
                    window.location.href = '/login';
                }, 1500);
            }
        }

        return response;
    },

    /**
     * Register new user
     */
    async register(userData) {
        try {
            console.log('Sending registration request to /api/auth/register');
            const response = await this.apiCall('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify(userData),
                skipAuth: true
            });

            const data = await response.json();
            console.log('Registration API response:', { status: response.status, data });

            if (!response.ok) {
                // Handle validation errors
                if (response.status === 422 && data.detail) {
                    // Format validation errors
                    if (Array.isArray(data.detail)) {
                        const errors = data.detail.map(err => `${err.loc.join('.')}: ${err.msg}`).join('\n');
                        throw new Error(errors);
                    }
                }
                throw new Error(data.detail || 'Registration failed');
            }

            return { success: true, data };
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Login user
     */
    async login(email, password) {
        try {
            const response = await this.apiCall('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
                skipAuth: true
            });

            const data = await response.json();

            if (!response.ok) {
                // Check for rate limiting
                const retryAfter = response.headers.get('Retry-After');
                if (retryAfter) {
                    throw new Error(`rate limit exceeded. Please wait ${retryAfter} seconds`);
                }
                throw new Error(data.detail || 'Login failed');
            }

            // Check if 2FA is required
            if (data.requires_2fa) {
                // 2FA is enabled, return data without saving token
                return { success: true, data };
            }

            // No 2FA required, save token and proceed
            if (data.access_token) {
                this.saveToken(data.access_token);

                // Get and save user data
                await this.fetchCurrentUser();
            }

            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Fetch current user data
     */
    async fetchCurrentUser() {
        try {
            const response = await this.apiCall('/api/auth/me');
            const data = await response.json();

            if (!response.ok) {
                throw new Error('Failed to fetch user data');
            }

            this.saveUser(data);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Logout user
     */
    async logout() {
        try {
            await this.apiCall('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            // Proceed with local logout even if API call fails
        }
        this.removeToken();
        window.location.href = '/login';
    },

    /**
     * Change password
     */
    async changePassword(oldPassword, newPassword) {
        try {
            const response = await this.apiCall('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    old_password: oldPassword,
                    new_password: newPassword
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Password change failed');
            }

            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Delete account
     */
    async deleteAccount() {
        try {
            const response = await this.apiCall('/api/auth/delete-account', {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Account deletion failed');
            }

            this.removeToken();
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Protect page - redirect to login if not authenticated
     */
    protectPage() {
        if (!this.isAuthenticated()) {
            window.location.href = '/login';
        }
    },

    /**
     * Redirect to dashboard if already authenticated
     */
    redirectIfAuthenticated() {
        if (this.isAuthenticated()) {
            window.location.href = '/dashboard';
        }
    },

    /**
     * Show success message
     */
    showSuccess(message) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Success!',
                text: message,
                icon: 'success',
                confirmButtonText: 'OK'
            });
        } else {
            alert(message);
        }
    },

    /**
     * Show error message
     */
    showError(message) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Error!',
                text: message,
                icon: 'error',
                confirmButtonText: 'OK'
            });
        } else {
            alert(message);
        }
    },

    /**
     * Show message in a UI container
     */
    showFormMessage(elementId, message, type) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = message;
        el.className = 'form-message ' + type;
    },

    /**
     * Clear message from a UI container
     */
    clearFormMessage(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = '';
        el.className = 'form-message';
    },

    /**
     * Set button to loading state
     */
    setButtonLoading(btnId, originalText) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span>Submitting';
    },

    /**
     * Reset button from loading state
     */
    resetButton(btnId, originalText) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = false;
        btn.textContent = originalText;
    },

    /**
     * Show loading indicator
     */
    showLoading(message = 'Please wait...') {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: message,
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
        }
    },

    /**
     * Close loading indicator
     */
    closeLoading() {
        if (typeof Swal !== 'undefined') {
            Swal.close();
        }
    }
};

// Export for use in other scripts
window.TED_AUTH = TED_AUTH;
