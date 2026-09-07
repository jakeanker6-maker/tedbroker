/**
 * Dashboard Page Handler
 * Manages user dashboard data display and authentication
 */

/**
 * Check if user has completed onboarding/KYC
 */
async function checkOnboardingStatus() {
    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/status');
        const data = await response.json();

        if (!data.is_onboarding_complete) {
            // Show KYC notification banner
            showKYCNotification();
            // Disable sidebar menu items until KYC is complete
            disableSidebarMenusForKYC();
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error checking onboarding status:', error);
        // Continue to dashboard even if check fails
        return true;
    }
}

/**
 * Check if user needs to complete the investment questionnaire
 */
async function checkQuestionnaireStatus() {
    try {
        const response = await TED_AUTH.apiCall('/api/onboarding/questionnaire-status');
        const data = await response.json();

        if (!data.completed) {
            const modal = document.getElementById('questionnaire-modal');
            if (modal) {
                modal.style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error checking questionnaire status:', error);
    }
}

function questionnaireNext(currentView) {
    const viewEl = document.getElementById(`q-view-${currentView}`);
    const radios = viewEl.querySelectorAll('input[type="radio"]');
    const selected = Array.from(radios).some(r => r.checked);

    if (!selected) {
        Swal.fire({ icon: 'warning', title: 'Selection Required', text: 'Please select an option before proceeding.', confirmButtonColor: '#D32F2F' });
        return;
    }

    viewEl.style.display = 'none';
    document.getElementById(`q-view-${currentView + 1}`).style.display = 'block';
    document.getElementById(`q-dot-${currentView}`).style.background = '#4CAF50';
    document.getElementById(`q-dot-${currentView + 1}`).style.background = '#D32F2F';
}

function questionnaireBack(currentView) {
    document.getElementById(`q-view-${currentView}`).style.display = 'none';
    document.getElementById(`q-view-${currentView - 1}`).style.display = 'block';
    document.getElementById(`q-dot-${currentView}`).style.background = '#ddd';
    document.getElementById(`q-dot-${currentView - 1}`).style.background = '#D32F2F';
}

async function submitQuestionnaire() {
    const employment = document.querySelector('input[name="employment_status"]:checked');
    if (!employment) {
        Swal.fire({ icon: 'warning', title: 'Selection Required', text: 'Please select an option before submitting.', confirmButtonColor: '#D32F2F' });
        return;
    }

    const payload = {
        risk_tolerance: document.querySelector('input[name="risk_tolerance"]:checked').value,
        annual_income: document.querySelector('input[name="annual_income"]:checked').value,
        employment_status: employment.value
    };

    try {
        TED_AUTH.showLoading('Saving your profile...');
        const response = await TED_AUTH.apiCall('/api/onboarding/questionnaire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        TED_AUTH.closeLoading();

        if (response.ok) {
            document.getElementById('questionnaire-modal').style.display = 'none';
            Swal.fire({ icon: 'success', title: 'Profile Complete', text: 'Your investment profile has been saved.', confirmButtonColor: '#D32F2F' });
        } else {
            const err = await response.json();
            Swal.fire({ icon: 'error', title: 'Error', text: err.detail || 'Failed to save questionnaire.', confirmButtonColor: '#D32F2F' });
        }
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ icon: 'error', title: 'Error', text: 'An error occurred. Please try again.', confirmButtonColor: '#D32F2F' });
    }
}

/**
 * Show KYC notification banner at the top of home tab
 */
function showKYCNotification() {
    console.log('showKYCNotification called');

    // Check if notification already exists
    if (document.getElementById('kyc-notification-banner')) {
        console.log('KYC notification already exists, skipping');
        return;
    }

    // Get current theme
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const isDark = currentTheme === 'dark';

    // Warning colors - prominent orange/amber theme
    const bgColor = isDark ? 'rgba(251, 146, 60, 0.2)' : 'rgba(254, 243, 199, 1)';
    const borderColor = isDark ? '#fb923c' : '#f59e0b';
    const textColor = isDark ? '#fef3c7' : '#78350f';
    const iconColor = isDark ? '#fb923c' : '#f59e0b';
    const buttonBg = isDark ? '#ea580c' : '#ea580c';
    const buttonText = '#ffffff';
    const buttonHoverBg = isDark ? '#c2410c' : '#c2410c';

    const banner = document.createElement('div');
    banner.id = 'kyc-notification-banner';
    banner.className = 'kyc-notification-theme';
    banner.style.cssText = `
        background: ${bgColor} !important;
        border: 3px solid ${borderColor} !important;
        border-radius: 12px !important;
        color: ${textColor} !important;
        padding: 24px 28px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 20px !important;
        box-shadow: 0 8px 20px rgba(245, 158, 11, 0.25) !important;
        animation: pulseAttention 2s ease-in-out infinite, fadeIn 0.4s ease-out !important;
        margin-bottom: 28px !important;
        position: relative !important;
        overflow: hidden !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 100 !important;
        min-height: 80px !important;
    `;

    banner.innerHTML = `
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, ${borderColor}, #fbbf24, ${borderColor}); animation: shimmer 2s linear infinite;"></div>
        <div style="display: flex; align-items: center; gap: 20px; flex: 1;">
            <div style="display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; background: ${isDark ? 'rgba(251, 146, 60, 0.3)' : 'rgba(251, 191, 36, 0.3)'}; border-radius: 50%; flex-shrink: 0;">
                <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: ${iconColor}; animation: shake 0.5s ease-in-out infinite alternate;"></i>
            </div>
            <div>
                <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px; color: ${textColor}; letter-spacing: -0.1px;">
                    ⚠️ Action Required: Complete Your KYC Verification
                </div>
                <div style="font-size: 10px; line-height: 1.5; color: ${textColor}; opacity: 0.9;">
                    Your account access is limited. Please complete your identity verification to unlock all features, start investing, and access the full platform.
                </div>
            </div>
        </div>
        <button
            onclick="window.location.href='/onboarding'"
            class="kyc-complete-btn"
            style="
                background: ${buttonBg};
                color: ${buttonText};
                border: none;
                padding: 16px 32px;
                border-radius: 10px;
                font-weight: 700;
                cursor: pointer;
                font-size: 16px;
                transition: all 0.3s ease;
                white-space: nowrap;
                box-shadow: 0 4px 14px rgba(234, 88, 12, 0.4);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                flex-shrink: 0;
            "
            onmouseover="this.style.background='${buttonHoverBg}'; this.style.transform='translateY(-3px) scale(1.02)'; this.style.boxShadow='0 8px 20px rgba(234, 88, 12, 0.5)';"
            onmouseout="this.style.background='${buttonBg}'; this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='0 4px 14px rgba(234, 88, 12, 0.4)';"
        >
            <i class="fas fa-arrow-right"></i> Complete Now
        </button>
    `;

    // Add animation keyframes if not already added
    if (!document.getElementById('kyc-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'kyc-notification-styles';
        style.textContent = `
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes fadeOut {
                from {
                    opacity: 1;
                    transform: translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateY(-20px);
                }
            }

            @keyframes pulseAttention {
                0%, 100% {
                    box-shadow: 0 8px 20px rgba(245, 158, 11, 0.25);
                }
                50% {
                    box-shadow: 0 8px 30px rgba(245, 158, 11, 0.45);
                }
            }

            @keyframes shake {
                0% { transform: rotate(-3deg); }
                100% { transform: rotate(3deg); }
            }

            @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }

            @media (max-width: 768px) {
                #kyc-notification-banner {
                    flex-direction: column;
                    text-align: center;
                    padding: 20px !important;
                }

                #kyc-notification-banner button {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Insert banner AFTER the welcome header and BEFORE the stat cards
    let inserted = false;

    const dashboardTab = document.getElementById('tab-dashboard');
    if (dashboardTab) {
        // Find the content-header element
        const contentHeader = dashboardTab.querySelector('.content-header');

        if (contentHeader) {
            // Insert AFTER the content-header (Welcome Back section)
            console.log('Found content-header, inserting banner AFTER it');
            contentHeader.insertAdjacentElement('afterend', banner);
            inserted = true;
            console.log('✓ Banner inserted successfully after Welcome header');
        } else {
            // Fallback: insert before stat-grid if content-header not found
            const statGrid = dashboardTab.querySelector('.stat-grid');
            if (statGrid) {
                console.log('content-header not found, inserting BEFORE stat-grid');
                statGrid.insertAdjacentElement('beforebegin', banner);
                inserted = true;
                console.log('✓ Banner inserted successfully before stat-grid');
            } else {
                // Last resort: insert as first child
                console.log('Neither content-header nor stat-grid found, inserting as first child');
                dashboardTab.insertBefore(banner, dashboardTab.firstChild);
                inserted = true;
                console.log('✓ Banner inserted as first child of tab-dashboard');
            }
        }
    } else {
        console.error('✗ tab-dashboard element not found!');
    }

    // Verify insertion after a brief delay
    setTimeout(() => {
        const insertedBanner = document.getElementById('kyc-notification-banner');
        if (insertedBanner) {
            const rect = insertedBanner.getBoundingClientRect();
            const styles = window.getComputedStyle(insertedBanner);

            console.log('✓ Banner verification:');
            console.log('  - In DOM: YES');
            console.log('  - Display:', styles.display);
            console.log('  - Visibility:', styles.visibility);
            console.log('  - Opacity:', styles.opacity);
            console.log('  - Dimensions:', insertedBanner.offsetWidth, 'x', insertedBanner.offsetHeight);
            console.log('  - Position (top, left):', rect.top, rect.left);
            console.log('  - Viewport visible:', rect.top >= 0 && rect.top < window.innerHeight);

            if (insertedBanner.offsetHeight === 0 || rect.height === 0) {
                console.error('✗ Banner has ZERO height - investigating parent...');
                let parent = insertedBanner.parentElement;
                while (parent) {
                    const parentStyles = window.getComputedStyle(parent);
                    console.log('  Parent:', parent.tagName, parent.id || parent.className);
                    console.log('    - Display:', parentStyles.display);
                    console.log('    - Height:', parent.offsetHeight);
                    if (parent === document.body) break;
                    parent = parent.parentElement;
                }
            } else {
                console.log('✓ Banner is visible with height:', insertedBanner.offsetHeight, 'px');
            }
        } else {
            console.error('✗ Banner NOT found in DOM after insertion!');
        }
    }, 200);

    if (!inserted) {
        console.error('Failed to insert KYC notification banner - no suitable container found');
    }

    // Update notification when theme changes
    const themeChangeHandler = function() {
        const existingBanner = document.getElementById('kyc-notification-banner');
        if (existingBanner) {
            existingBanner.remove();
            showKYCNotification();
        }
    };

    // Remove old listener if exists and add new one
    document.removeEventListener('themeChanged', themeChangeHandler);
    document.addEventListener('themeChanged', themeChangeHandler);
}

/**
 * Disable all sidebar menu items until KYC is complete
 * This applies to ALL users who haven't completed onboarding, including existing users
 */
function disableSidebarMenusForKYC() {
    console.log('Disabling sidebar menus due to incomplete KYC');
    const menuItems = document.querySelectorAll('.menu-item, .submenu-item');

    menuItems.forEach(item => {
        // Skip the overview/dashboard/home tab - allow it to stay active
        const tabName = item.getAttribute('data-tab');
        if (tabName === 'overview' || tabName === 'dashboard' || tabName === 'home') {
            return;
        }

        // Skip the logout button - users should always be able to logout
        if (item.classList.contains('logout-btn') || item.onclick?.toString().includes('logout')) {
            return;
        }

        // Add disabled styling with lock icon
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
        item.style.pointerEvents = 'auto'; // Keep auto so click handler works
        item.style.position = 'relative';

        // Add a data attribute to track disabled state
        item.setAttribute('data-kyc-disabled', 'true');
        item.setAttribute('title', '🔒 Complete KYC verification to unlock this feature');

        // Add lock icon if not already present
        if (!item.querySelector('.kyc-lock-icon')) {
            const lockIcon = document.createElement('i');
            lockIcon.className = 'fas fa-lock kyc-lock-icon';
            lockIcon.style.cssText = `
                position: absolute;
                right: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: #f59e0b;
                font-size: 12px;
            `;
            item.style.position = 'relative';
            item.appendChild(lockIcon);
        }

        // Add click handler to show warning message
        const clickHandler = function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'warning',
                    title: '🔒 Feature Locked',
                    html: '<p style="font-size: 16px; line-height: 1.6;">Complete your KYC verification to unlock all platform features.</p>',
                    confirmButtonText: '✓ Complete KYC Now',
                    confirmButtonColor: '#ea580c',
                    showCancelButton: true,
                    cancelButtonText: 'Later',
                    cancelButtonColor: '#6b7280'
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.location.href = '/onboarding';
                    }
                });
            } else {
                alert('Please complete your KYC verification to access this feature.');
            }
            return false;
        };

        // Remove any existing listeners
        item.removeEventListener('click', clickHandler, true);
        // Add click handler with capture to intercept all clicks
        item.addEventListener('click', clickHandler, true);
    });

    console.log(`Disabled ${document.querySelectorAll('[data-kyc-disabled="true"]').length} menu items`);

    // Disable and blur the Quick Actions card instead of hiding it
    const quickActionsCard = document.getElementById('quick-actions-card');
    if (quickActionsCard) {
        quickActionsCard.classList.add('kyc-pending');
        quickActionsCard.setAttribute('data-kyc-disabled', 'true');

        // Get the quick actions grid and disable it
        const quickActionsGrid = quickActionsCard.querySelector('.quick-actions-grid');
        if (quickActionsGrid) {
            quickActionsGrid.classList.add('disabled');

            // Disable all buttons individually
            const buttons = quickActionsGrid.querySelectorAll('button');
            buttons.forEach(button => {
                button.classList.add('disabled');
                button.setAttribute('disabled', 'true');
                button.style.cursor = 'not-allowed';

                // Store original onclick handler
                const originalOnclick = button.getAttribute('onclick');
                if (originalOnclick) {
                    button.setAttribute('data-original-onclick', originalOnclick);
                    button.removeAttribute('onclick');
                }

                // Add click handler to show KYC warning
                const kycWarningHandler = function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'warning',
                            title: '🔒 Feature Locked',
                            html: '<p style="font-size: 16px; line-height: 1.6;">Please complete your KYC verification and wait for admin approval to access Quick Actions.</p>',
                            confirmButtonText: '✓ Complete KYC Now',
                            confirmButtonColor: '#ea580c',
                            showCancelButton: true,
                            cancelButtonText: 'Later',
                            cancelButtonColor: '#6b7280'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                window.location.href = '/onboarding';
                            }
                        });
                    } else {
                        alert('Please complete your KYC verification to access this feature.');
                    }
                    return false;
                };

                button.addEventListener('click', kycWarningHandler, true);
                button.setAttribute('data-kyc-warning-attached', 'true');
            });
        }

        console.log('Disabled and blurred Quick Actions card due to incomplete KYC');
    }
}

/**
 * Enable all sidebar menu items after KYC completion
 */
function enableSidebarMenus() {
    console.log('Enabling sidebar menus - KYC completed');
    const menuItems = document.querySelectorAll('[data-kyc-disabled="true"]');

    menuItems.forEach(item => {
        // Remove disabled styling
        item.style.opacity = '';
        item.style.cursor = '';
        item.style.pointerEvents = '';
        item.style.position = '';
        item.removeAttribute('data-kyc-disabled');
        item.removeAttribute('title');

        // Remove lock icon
        const lockIcon = item.querySelector('.kyc-lock-icon');
        if (lockIcon) {
            lockIcon.remove();
        }
    });

    // Remove KYC notification banner if it exists
    const banner = document.getElementById('kyc-notification-banner');
    if (banner) {
        banner.style.animation = 'fadeOut 0.4s ease-out';
        setTimeout(() => {
            banner.remove();
        }, 400);
    }

    // Re-enable the Quick Actions card
    const quickActionsCard = document.getElementById('quick-actions-card');
    if (quickActionsCard) {
        // Remove disabled state from card
        quickActionsCard.classList.remove('kyc-pending');
        quickActionsCard.removeAttribute('data-kyc-disabled');
        quickActionsCard.style.display = '';
        quickActionsCard.removeAttribute('data-kyc-hidden');

        // Re-enable the quick actions grid
        const quickActionsGrid = quickActionsCard.querySelector('.quick-actions-grid');
        if (quickActionsGrid) {
            quickActionsGrid.classList.remove('disabled');

            // Re-enable all buttons
            const buttons = quickActionsGrid.querySelectorAll('button');
            buttons.forEach(button => {
                button.classList.remove('disabled');
                button.removeAttribute('disabled');
                button.style.cursor = '';

                // Restore original onclick handler
                const originalOnclick = button.getAttribute('data-original-onclick');
                if (originalOnclick) {
                    button.setAttribute('onclick', originalOnclick);
                    button.removeAttribute('data-original-onclick');
                }

                // Remove KYC warning handler
                if (button.getAttribute('data-kyc-warning-attached') === 'true') {
                    // Clone and replace to remove event listeners
                    const newButton = button.cloneNode(true);
                    newButton.removeAttribute('data-kyc-warning-attached');
                    button.parentNode.replaceChild(newButton, button);
                }
            });
        }

        console.log('Re-enabled Quick Actions card - KYC completed and approved');
    }

    console.log('Sidebar menus enabled - user can now access all features');
}

document.addEventListener('DOMContentLoaded', async function() {
    // Check for OAuth token in URL (from redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    let isOAuthLogin = false;

    if (token) {
        // Save token from OAuth redirect
        TED_AUTH.saveToken(token);
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        isOAuthLogin = true;
    }

    // Protect the page - redirect to login if not authenticated
    TED_AUTH.protectPage();

    // Get user data to check access status
    TED_AUTH.showLoading('Verifying access...');
    const accessCheck = await TED_AUTH.fetchCurrentUser();
    TED_AUTH.closeLoading();

    if (!accessCheck.success) {
        TED_AUTH.showError('Failed to verify access. Please login again.');
        TED_AUTH.logout();
        return;
    }

    // Store access_granted status for use throughout dashboard
    const hasAccess = accessCheck.data.access_granted;

    // Check if user has been granted dashboard access
    if (!hasAccess) {
        console.log('⚠️ User access_granted = false. Disabling dashboard features...');
        // Disable all sidebar menu items except logout
        // Use setTimeout to ensure DOM elements are fully rendered
        setTimeout(() => {
            console.log('⏳ Calling disableSidebarMenus() for unapproved user...');
            disableSidebarMenus();
        }, 100);

        // Show notification banner about pending approval
        showPendingApprovalBanner();
    } else {
        console.log('✅ User access_granted = true. Full dashboard access enabled.');
    }

    // Check onboarding status - redirect if incomplete
    await checkOnboardingStatus();

    // Check if investment questionnaire needs to be shown
    await checkQuestionnaireStatus();

    // Load notifications
    await loadNotifications();

    // Get user data from localStorage
    let userData = TED_AUTH.getUser();

    // If no user data in localStorage OR this is an OAuth login, fetch fresh data from API
    if (!userData || isOAuthLogin) {
        TED_AUTH.showLoading('Loading your profile...');
        const result = await TED_AUTH.fetchCurrentUser();
        TED_AUTH.closeLoading();

        if (!result.success) {
            TED_AUTH.showError('Failed to load user data. Please login again.');
            TED_AUTH.logout();
            return;
        }

        userData = result.data;
    }

    // Populate dashboard with user data
    populateDashboard(userData);

    // Check if Google OAuth user needs to set password
    checkAndShowPasswordSetupModal(userData);

    // Update password button based on user's password status
    updatePasswordButtonUI(userData);

    // Load active investments on dashboard
    loadDashboardActiveInvestments();

    // Load dashboard stats (portfolio value, active copies, total return)
    loadDashboardStats();

    // Check if user is new and hasn't been referred yet
    checkAndShowReferralModal(userData);

    // Load default tab (traders) data on initial page load
    if (typeof loadTabData === 'function') {
        loadTabData('traders');
    }
});

/**
 * Populate dashboard with user information
 */
function populateDashboard(userData) {
    // Display name (use full name if available, otherwise username)
    const displayName = userData.full_name || userData.username;
    document.getElementById('user-display-name').textContent = displayName;

    // User avatar (first letter of name)
    const avatarLetter = displayName.charAt(0).toUpperCase();
    const userAvatarElement = document.getElementById('user-avatar');
    if (userAvatarElement) {
        userAvatarElement.textContent = avatarLetter;
    }

    // Populate app bar user profile
    const sidebarAvatarElement = document.getElementById('app-bar-user-avatar');
    if (sidebarAvatarElement) {
        sidebarAvatarElement.textContent = avatarLetter;
    }
    const sidebarFullNameElement = document.getElementById('app-bar-user-full-name');
    if (sidebarFullNameElement) {
        sidebarFullNameElement.textContent = displayName;
    }
    const sidebarUsernameElement = document.getElementById('app-bar-user-username');
    if (sidebarUsernameElement) {
        sidebarUsernameElement.textContent = '@' + userData.username;
    }

    // Full name
    document.getElementById('user-fullname').textContent = userData.full_name || userData.username;

    // Username
    document.getElementById('user-username').textContent = '@' + userData.username;

    // Email
    document.getElementById('user-email').textContent = userData.email;

    // Update mobile nav profile with real user data
    if (typeof window.populateMobileProfile === 'function') {
        window.populateMobileProfile(userData);
    }

    // Email in security section
    const securityEmailElement = document.getElementById('security-user-email');
    if (securityEmailElement) {
        securityEmailElement.textContent = userData.email;
    }

    // Phone (show only if provided)
    if (userData.phone) {
        document.getElementById('user-phone').textContent = userData.phone;
        document.getElementById('user-phone-row').style.display = 'flex';
    }

    // Gender (show only if provided)
    if (userData.gender) {
        document.getElementById('user-gender').textContent = userData.gender;
        document.getElementById('user-gender-row').style.display = 'flex';
    }

    // Country (show only if provided)
    if (userData.country) {
        document.getElementById('user-country').textContent = userData.country;
        document.getElementById('user-country-row').style.display = 'flex';
    }

    // Account types (show only if provided)
    if (userData.account_types && userData.account_types.length > 0) {
        const accountTypesText = userData.account_types.join(', ');
        document.getElementById('user-account-types').textContent = accountTypesText;
        document.getElementById('user-account-types-row').style.display = 'flex';
    }

    // Account status
    const statusElement = document.getElementById('user-status');
    if (userData.is_active) {
        statusElement.textContent = 'Active';
        statusElement.className = 'badge-status badge-active';
    } else {
        statusElement.textContent = 'Inactive';
        statusElement.className = 'badge-status badge-inactive';
    }

    // Verification status
    const verificationElement = document.getElementById('user-verification');
    if (userData.is_verified) {
        verificationElement.textContent = 'Verified';
        verificationElement.className = 'badge-status badge-active';
    } else {
        verificationElement.textContent = 'Pending';
        verificationElement.className = 'badge-status badge-pending';
    }

    // Member since date
    if (userData.created_at) {
        const createdDate = new Date(userData.created_at);
        const formattedDate = formatDate(createdDate);
        document.getElementById('user-created').textContent = formattedDate;
    }

    // Wallet Balance - Display user's actual balance from database
    const walletBalance = userData.wallet_balance || 0;
    const walletBalanceDisplayElement = document.getElementById('wallet-balance-display');
    if (walletBalanceDisplayElement) {
        walletBalanceDisplayElement.textContent = `$${walletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    const walletBalanceElement = document.getElementById('wallet-balance');
    if (walletBalanceElement) {
        walletBalanceElement.textContent = `$${walletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    const withdrawBalanceElement = document.getElementById('withdraw-available-balance');
    if (withdrawBalanceElement) {
        withdrawBalanceElement.textContent = `$${walletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    console.log('Dashboard populated with user data:', userData);
}

/**
 * Format date to readable string
 */
function formatDate(date) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

/**
 * Handle logout
 */
async function handleLogout() {
    if ((await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to logout?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
        TED_AUTH.logout();
    }
}

/**
 * Load and display expert traders from API
 */
let tradersLoaded = false; // Flag to prevent multiple loads
let tradersCache = null; // Cache traders data

async function loadExpertTraders(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (tradersLoaded && !forceReload && tradersCache) {
        // Display cached traders
        displayTraders(tradersCache);
        return;
    }

    const container = document.getElementById('traders-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading traders...</p>';

    try {
        // Get JWT token using the auth utility
        const token = TED_AUTH.getToken();
        if (!token) {
            container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Authentication required. Please login again.</p>';
            return;
        }

        // Fetch traders from API using the auth utility
        const response = await TED_AUTH.apiCall('/api/traders/', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch traders: ${response.statusText}`);
        }

        const traders = await response.json();

        // Cache the traders
        tradersCache = traders;
        tradersLoaded = true;

        // Display traders
        displayTraders(traders);
    } catch (error) {
        console.error('Error loading traders:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load traders. Please try again later.</p>';
    }
}

let recentTradesCache = null;

function formatOrderType(orderType) {
    const types = {
        'market': 'Market',
        'limit': 'Limit',
        'stop_loss': 'Stop Loss',
        'take_profit': 'Take Profit'
    };
    return types[orderType] || orderType;
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

async function loadRecentTrades(forceReload = false) {
    if (recentTradesCache && !forceReload) {
        displayRecentTrades(recentTradesCache);
        return;
    }
    
    const container = document.getElementById('recent-trades-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading recent trades...</p>';
    
    try {
        const response = await TED_AUTH.apiCall('/api/traders/', {
            method: 'GET'
        });
        
        if (!response.ok) throw new Error('Failed to fetch traders: ' + response.status);
        
        const traders = await response.json();
        
        let allTrades = [];
        traders.forEach(trader => {
            const trades = trader.recent_trades || [];
            trades.forEach(trade => {
                allTrades.push({
                    ...trade,
                    trader_id: trader.id,
                    trader_name: trader.full_name,
                    trader_photo: trader.profile_photo
                });
            });
        });
        
        allTrades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        recentTradesCache = allTrades;
        displayRecentTrades(allTrades);
        
    } catch (error) {
        console.error('Error loading recent trades:', error);
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Failed to load recent trades: ' + error.message + '</p>';
    }
}

function viewAllTraderTrades(traderId, traderName) {
    console.log('[viewAllTraderTrades] Navigating to Recent Trades for trader:', traderId, traderName);
    
    // Close the modal first
    Swal.close();
    
    // Navigate to Recent Trades tab
    document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
    document.querySelectorAll('.submenu-item').forEach(si => si.classList.remove('active'));
    
    const recentTradesTab = document.querySelector('.submenu-item[data-tab="recent-trades"]');
    if (recentTradesTab) {
        recentTradesTab.classList.add('active');
    }
    
    document.querySelectorAll('.tab-content-wrapper').forEach(tc => tc.classList.remove('active'));
    const recentTradesContent = document.getElementById('tab-recent-trades');
    if (recentTradesContent) {
        recentTradesContent.classList.add('active');
    }
    
    // Load recent trades if not already loaded
    if (!recentTradesCache) {
        loadRecentTrades(true);
    }
    
    // Set the trader ID filter and search term
    setTimeout(() => {
        const traderIdInput = document.getElementById('trades-trader-filter');
        const searchInput = document.getElementById('recent-trades-search');
        
        if (traderIdInput) {
            traderIdInput.value = traderId;
        }
        if (searchInput) {
            searchInput.value = traderName;
        }
        
        // Trigger filter
        filterRecentTrades();
    }, 300);
}

function filterRecentTrades() {
    const searchTerm = document.getElementById('recent-trades-search')?.value.toLowerCase() || '';
    const traderFilter = document.getElementById('trades-trader-filter')?.value || '';
    const sideFilter = document.getElementById('trades-side-filter')?.value || '';
    const exchangeFilter = document.getElementById('trades-exchange-filter')?.value || '';
    const orderTypeFilter = document.getElementById('trades-ordertype-filter')?.value || '';
    
    if (!recentTradesCache) return;
    
    let filtered = recentTradesCache.filter(trade => {
        if (traderFilter && trade.trader_id !== traderFilter) return false;
        
        if (searchTerm) {
            const symbolMatch = trade.symbol?.toLowerCase().includes(searchTerm);
            const traderMatch = trade.trader_name?.toLowerCase().includes(searchTerm);
            if (!symbolMatch && !traderMatch) return false;
        }
        
        if (sideFilter && trade.side !== sideFilter) return false;
        
        if (exchangeFilter && !trade.exchange?.toLowerCase().includes(exchangeFilter.toLowerCase())) return false;
        
        if (orderTypeFilter && trade.order_type !== orderTypeFilter) return false;
        
        return true;
    });
    
    displayRecentTrades(filtered);
}

function filterPosts() {
    const searchTerm = document.getElementById('posts-search')?.value.toLowerCase() || '';
    const traderFilter = document.getElementById('posts-trader-filter')?.value || '';
    const sortFilter = document.getElementById('posts-sort-filter')?.value || 'newest';
    
    if (!postsCache) return;
    
    let filtered = postsCache.filter(post => {
        if (searchTerm) {
            const contentMatch = post.content?.toLowerCase().includes(searchTerm);
            const traderMatch = post.trader_name?.toLowerCase().includes(searchTerm);
            if (!contentMatch && !traderMatch) return false;
        }
        
        if (traderFilter && post.trader_id !== traderFilter) return false;
        
        return true;
    });
    
    // Sort
    if (sortFilter === 'oldest') {
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortFilter === 'most-liked') {
        filtered.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
    } else {
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    
    renderPosts(filtered);
}

function displayRecentTrades(trades) {
    const container = document.getElementById('recent-trades-container');
    
    if (trades.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No recent trades available.</p>';
        return;
    }
    
    const tradesHTML = trades.slice(0, 50).map(trade => {
        const sideClass = trade.side === 'long' ? 'long' : 'short';
        const tradeAvatarHtml = (trade.trader_photo && trade.trader_photo.trim())
            ? `<img src="${trade.trader_photo}" class="recent-trade-avatar" onerror="this.outerHTML='<div class=\\'recent-trade-avatar\\'><i class=\\'fa-solid fa-user\\'></i></div>'" />`
            : `<div class="recent-trade-avatar"><i class="fa-solid fa-user"></i></div>`;
        
        return `
            <div class="recent-trade-card">
                <div class="recent-trade-header">
                    <div class="recent-trade-trader">
                        ${tradeAvatarHtml}
                        <span class="recent-trade-trader-name">${trade.trader_name}</span>
                    </div>
                    <span class="recent-trade-time">${formatTimestamp(trade.timestamp)}</span>
                </div>
                <div class="recent-trade-body">
                    <div class="recent-trade-main">
                        <span class="recent-trade-symbol">${trade.symbol}</span>
                        <span class="recent-trade-exchange">${trade.exchange}</span>
                        <span class="recent-trade-side ${sideClass}">${trade.side.toUpperCase()}</span>
                    </div>
                    <div class="recent-trade-details">
                        <div class="recent-trade-detail">
                            <span class="label">Order Type</span>
                            <span class="value">${formatOrderType(trade.order_type)}</span>
                        </div>
                        <div class="recent-trade-detail">
                            <span class="label">Entry</span>
                            <span class="value">$${trade.entry_price?.toLocaleString()}</span>
                        </div>
                        <div class="recent-trade-detail">
                            <span class="label">Notional</span>
                            <span class="value">$${trade.notional_value?.toLocaleString()}</span>
                        </div>
                        <div class="recent-trade-detail">
                            <span class="label">Leverage</span>
                            <span class="value">${trade.leverage}x</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `<div class="recent-trades-grid">${tradesHTML}</div>`;
}

function filterTraders() {
    const searchTerm = document.getElementById('traders-search')?.value.toLowerCase() || '';
    const specialization = document.getElementById('traders-specialization-filter')?.value || '';
    const riskFilter = document.getElementById('traders-risk-filter')?.value || '';
    const winrateFilter = document.getElementById('traders-winrate-filter')?.value || '';
    
    if (!tradersCache) return;
    
    let filtered = tradersCache.filter(trader => {
        if (searchTerm && !trader.full_name.toLowerCase().includes(searchTerm)) {
            return false;
        }
        
        if (specialization && !trader.specialization.toLowerCase().includes(specialization.toLowerCase())) {
            return false;
        }
        
        if (riskFilter) {
            const risk = trader.risk_score || 5;
            if (riskFilter === '1-3' && (risk < 1 || risk > 3)) return false;
            if (riskFilter === '4-6' && (risk < 4 || risk > 6)) return false;
            if (riskFilter === '7-10' && (risk < 7 || risk > 10)) return false;
        }
        
        if (winrateFilter) {
            const winRate = trader.win_rate || 0;
            if (winrateFilter === '70+' && winRate < 70) return false;
            if (winrateFilter === '50-70' && (winRate < 50 || winRate > 70)) return false;
            if (winrateFilter === '<50' && winRate >= 50) return false;
        }
        
        return true;
    });
    
    displayTraders(filtered);
}

/**
 * Display traders in the container
 */
function displayTraders(traders) {
    const container = document.getElementById('traders-container');

    if (traders.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No expert traders available at the moment.</p>';
        return;
    }

    container.innerHTML = '';
    traders.forEach(trader => {
        const traderCard = createTraderCard(trader);
        container.appendChild(traderCard);
    });
}

/**
 * Create a trader strip element (expandable thin list item)
 */
function createTraderCard(trader) {
    const strip = document.createElement('div');
    strip.className = 'trader-strip';
    strip.setAttribute('data-trader-id', trader.id);

    const returnColor = trader.ytd_return > 0 ? '#4caf50' : '#f44336';
    const returnSign = trader.ytd_return > 0 ? '+' : '';

    const userData = TED_AUTH.getUser();
    const selectedTraders = userData?.selected_traders || [];
    const isSelected = selectedTraders.includes(trader.id);

    const userBalance = userData?.wallet_balance || 0;
    const minimumRequired = trader.minimum_copy_amount || 100;
    const hasSufficientFunds = userBalance >= minimumRequired;
    const canCopyTrader = hasSufficientFunds || isSelected;

    const assetsAUM = trader.assets_under_management || 0;
    const maxDrawdown = trader.max_drawdown || 0;
    const riskScore = trader.risk_score || 5;
    
    const riskColor = riskScore <= 3 ? '#4caf50' : (riskScore <= 6 ? '#ff9800' : '#f44336');

    const profilePhotoHTML = (trader.profile_photo && trader.profile_photo.trim())
        ? `<img src="${trader.profile_photo}" alt="${trader.full_name}" class="trader-strip-photo" onerror="this.outerHTML='<div class=\\'trader-strip-photo\\'><i class=\\'fa-solid fa-user\\'></i></div>'" />`
        : `<div class="trader-strip-photo"><i class="fa-solid fa-user"></i></div>`;

    const tradesHTML = trader.trades && trader.trades.length > 0 ? `
        <div class="trader-strip-trades">
            <div class="trader-strip-trades-title">Recent Trades</div>
            <div class="trader-strip-trades-grid">
                ${trader.trades.map(trade => `
                    <div class="trader-strip-trade-item">
                        <span class="trade-ticker">${trade.ticker}</span>
                        <span class="trade-price">$${trade.current_price.toLocaleString()}</span>
                        <span class="trade-position ${trade.position}">${trade.position.toUpperCase()}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    strip.innerHTML = `
        <div class="trader-strip-header" onclick="toggleTraderStrip('${trader.id}')">
            <div class="trader-strip-main">
                ${profilePhotoHTML}
                <div class="trader-strip-info">
                    <span class="trader-strip-name">${trader.full_name}</span>
                    <span class="trader-strip-spec">${trader.specialization}</span>
                </div>
            </div>
            <div class="trader-strip-meta">
                <span class="trader-strip-return" style="color: ${returnColor};">${returnSign}${trader.ytd_return}%</span>
                <span class="trader-strip-winrate">${trader.win_rate}% WR</span>
                <span class="trader-strip-risk" style="color: ${riskColor};">Risk: ${riskScore}</span>
            </div>
            <div class="trader-strip-chevron">
                <i class="fa fa-chevron-down"></i>
            </div>
        </div>
        <div class="trader-strip-content" id="trader-content-${trader.id}">
            <div class="trader-strip-details">
                <p class="trader-strip-desc">${trader.description}</p>
                
                <div class="trader-strip-stats-row">
                    <div class="trader-strip-stat-item">
                        <span class="label">Min. to Copy</span>
                        <span class="value">$${minimumRequired.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                    <div class="trader-strip-stat-item">
                        <span class="label">AUM</span>
                        <span class="value">$${assetsAUM >= 1000000 ? (assetsAUM/1000000).toFixed(1) + 'M' : assetsAUM.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
                    </div>
                    <div class="trader-strip-stat-item">
                        <span class="label">Max Drawdown</span>
                        <span class="value" style="color: ${maxDrawdown > 20 ? '#f44336' : '#ff9800'};">${maxDrawdown}%</span>
                    </div>
                    <div class="trader-strip-stat-item">
                        <span class="label">Risk Score</span>
                        <span class="value" style="color: ${riskColor};">${riskScore}/10</span>
                    </div>
                </div>

                ${!hasSufficientFunds && !isSelected ? `
                    <div class="trader-strip-warning">
                        <i class="fa fa-exclamation-triangle"></i>
                        <span>Insufficient funds. Need $${(minimumRequired - userBalance).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} more</span>
                    </div>
                ` : ''}

                ${tradesHTML}

                <div class="trader-strip-actions">
                    <button
                        class="trader-strip-btn copy ${isSelected ? 'active' : ''}"
                        ${!canCopyTrader ? 'disabled' : ''}
                        ${canCopyTrader ? `onclick="event.stopPropagation(); copyTrader('${trader.id}', '${trader.full_name}')"` : ''}
                    >
                        ${isSelected ? '<i class="fa fa-check"></i> Copying' : '<i class="fa fa-copy"></i> Copy Trader'}
                    </button>
                    <button
                        class="trader-strip-btn trades"
                        onclick="event.stopPropagation(); viewAllTraderTrades('${trader.id}', '${trader.full_name}');"
                    >
                        <i class="fa fa-exchange"></i> Recent Trades
                    </button>
                    <button
                        class="trader-strip-btn profile"
                        onclick="event.stopPropagation(); viewTraderProfile('${trader.id}', '${trader.full_name}')"
                    >
                        <i class="fa fa-user"></i> Full Profile
                    </button>
                    <button
                        class="trader-strip-btn track ${isSelected ? 'tracking' : ''}"
                        onclick="event.stopPropagation(); trackTrader('${trader.id}', '${trader.full_name}')"
                    >
                        <i class="fa fa-line-chart"></i> ${isSelected ? 'Tracking' : 'Track Trader'}
                    </button>
                </div>
            </div>
        </div>
    `;

    return strip;
}

/**
 * View trader full profile
 */
function viewTraderProfile(traderId, traderName) {
    const traders = tradersCache || [];
    const trader = traders.find(t => t.id === traderId);
    
    if (!trader) return;

    const returnColor = trader.ytd_return > 0 ? '#4caf50' : '#f44336';
    const returnSign = trader.ytd_return > 0 ? '+' : '';
    const riskScore = trader.risk_score || 5;
    const riskColor = riskScore <= 3 ? '#4caf50' : (riskScore <= 6 ? '#ff9800' : '#f44336');
    const maxDrawdown = trader.max_drawdown || 0;
    const assetsAUM = trader.assets_under_management || 0;

    const recentTradesHTML = trader.recent_trades && trader.recent_trades.length > 0 ? `
        <div class="trader-profile-recent-trades">
            <div class="recent-trades-header-row">
                <h4>Recent Trades (10)</h4>
                <a href="#" class="view-all-trades-link view-all-trades-btn" data-trader-id="${trader.id}" data-trader-name="${trader.full_name}">View All <i class="fa-solid fa-arrow-right"></i></a>
            </div>
            <div class="trader-profile-recent-trades-list">
                ${trader.recent_trades.map(trade => `
                    <div class="trader-profile-recent-trade-item">
                        <div class="trade-main-info">
                            <span class="trade-symbol">${trade.symbol}</span>
                            <span class="trade-exchange">${trade.exchange}</span>
                            <span class="trade-side ${trade.side}">${trade.side.toUpperCase()}</span>
                        </div>
                        <div class="trade-details-info">
                            <span class="trade-order-type">${formatOrderType(trade.order_type)}</span>
                            <span class="trade-entry">$${trade.entry_price?.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <span class="trade-notional">$${trade.notional_value?.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <span class="trade-leverage">${trade.leverage}x</span>
                        </div>
                        <div class="trade-timestamp">${formatTimestamp(trade.timestamp)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '<p style="color: #8b93a7; text-align: center;">No recent trades available</p>';

    const profileImgHtml = (trader.profile_photo && trader.profile_photo.trim())
        ? `<img src="${trader.profile_photo}" alt="${trader.full_name}" class="trader-profile-img" onerror="this.outerHTML='<div class=\\'trader-profile-img-placeholder\\'><i class=\\'fa-solid fa-user\\'></i></div>'" />`
        : `<div class="trader-profile-img-placeholder"><i class="fa-solid fa-user"></i></div>`;

    Swal.fire({
        title: trader.full_name,
        html: `
            <div class="trader-profile-modal">
                <div class="trader-profile-header">
                    ${profileImgHtml}
                    <div class="trader-profile-info">
                        <h3>${trader.full_name}</h3>
                        <p class="trader-profile-spec">${trader.specialization}</p>
                    </div>
                </div>
                <div class="trader-profile-stats">
                    <div class="trader-profile-stat">
                        <span class="value" style="color: ${returnColor};">${returnSign}${trader.ytd_return}%</span>
                        <span class="label">YTD Return</span>
                    </div>
                    <div class="trader-profile-stat">
                        <span class="value">${trader.win_rate}%</span>
                        <span class="label">Win Rate</span>
                    </div>
                    <div class="trader-profile-stat">
                        <span class="value">${trader.copiers}</span>
                        <span class="label">Copiers</span>
                    </div>
                    <div class="trader-profile-stat">
                        <span class="value" style="color: ${riskColor};">${riskScore}/10</span>
                        <span class="label">Risk Score</span>
                    </div>
                </div>
                <div class="trader-profile-stats" style="margin-top: 10px;">
                    <div class="trader-profile-stat">
                        <span class="value">$${assetsAUM >= 1000000 ? (assetsAUM/1000000).toFixed(1) + 'M' : assetsAUM.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
                        <span class="label">AUM</span>
                    </div>
                    <div class="trader-profile-stat">
                        <span class="value" style="color: ${maxDrawdown > 20 ? '#f44336' : '#ff9800'};">${maxDrawdown}%</span>
                        <span class="label">Max Drawdown</span>
                    </div>
                    <div class="trader-profile-stat">
                        <span class="value">$${trader.minimum_copy_amount?.toLocaleString() || '100'}</span>
                        <span class="label">Min. Amount</span>
                    </div>
                </div>
                <div class="trader-profile-actions">
                    <button class="btn-primary-custom trader-recent-trades-btn" data-trader-id="${trader.id}" data-trader-name="${trader.full_name}">
                        <i class="fa-solid fa-clock-rotate-left"></i> Recent Trades
                    </button>
                </div>
                <div class="trader-profile-desc">
                    <h4>About</h4>
                    <p>${trader.description}</p>
                </div>
                ${recentTradesHTML}
            </div>
        `,
        width: '650px',
        showConfirmButton: true,
        confirmButtonText: 'Close',
        customClass: {
            popup: 'trader-profile-popup'
        },
        didOpen: () => {
            // Add event listener for the Recent Trades button
            const recentTradesBtn = document.querySelector('.trader-recent-trades-btn');
            if (recentTradesBtn) {
                recentTradesBtn.addEventListener('click', function() {
                    const traderId = this.getAttribute('data-trader-id');
                    const traderName = this.getAttribute('data-trader-name');
                    viewAllTraderTrades(traderId, traderName);
                });
            }
            
            // Add event listener for the View All link
            const viewAllTradesBtn = document.querySelector('.view-all-trades-btn');
            if (viewAllTradesBtn) {
                viewAllTradesBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    const traderId = this.getAttribute('data-trader-id');
                    const traderName = this.getAttribute('data-trader-name');
                    viewAllTraderTrades(traderId, traderName);
                });
            }
        }
    });
}

// Posts functions - global scope
let postsCache = null;
let currentUserId = null;

async function loadPosts(forceReload = false) {
    console.log('[loadPosts] Called, forceReload:', forceReload);
    
    if (postsCache && !forceReload) {
        console.log('[loadPosts] Using cache, count:', postsCache.length);
        renderPosts(postsCache);
        return;
    }
    
    const container = document.getElementById('posts-container');
    if (!container) {
        console.error('[loadPosts] posts-container not found!');
        return;
    }
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading posts...</p>';
    
    try {
        console.log('[loadPosts] Fetching from API...');
        console.log('[loadPosts] Full URL:', TED_AUTH.API_BASE + '/api/traders/posts');
        const postsResponse = await TED_AUTH.apiCall('/api/traders/posts', { method: 'GET' });
        console.log('[loadPosts] Response status:', postsResponse.status);
        
        if (!postsResponse.ok) {
            throw new Error('Failed to fetch posts: ' + postsResponse.status);
        }
        
        const posts = await postsResponse.json();
        console.log('[loadPosts] Posts received:', posts.length, posts);
        
        // Try to get current user for like status
        try {
            const userResponse = await TED_AUTH.apiCall('/api/auth/me', { method: 'GET' });
            if (userResponse.ok) {
                const userData = await userResponse.json();
                currentUserId = userData.id;
            }
        } catch (e) {
            console.log('Could not fetch user:', e);
        }
        
        postsCache = posts;
        
        // Populate trader filter dropdown
        const traderSelect = document.getElementById('posts-trader-filter');
        if (traderSelect) {
            const uniqueTraders = [];
            const seen = new Set();
            posts.forEach(post => {
                if (post.trader_id && !seen.has(post.trader_id)) {
                    seen.add(post.trader_id);
                    uniqueTraders.push({ id: post.trader_id, name: post.trader_name });
                }
            });
            // Also add traders from cache if available
            if (tradersCache) {
                tradersCache.forEach(trader => {
                    if (!seen.has(trader.id)) {
                        seen.add(trader.id);
                        uniqueTraders.push({ id: trader.id, name: trader.name });
                    }
                });
            }
            traderSelect.innerHTML = '<option value="">All Traders</option>' + 
                uniqueTraders.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        }
        
        renderPosts(posts);
        
    } catch (error) {
        console.error('[loadPosts] Error:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load posts: ' + error.message + '</p>';
    }
}

function renderPosts(posts) {
    console.log('[renderPosts] Called with:', posts);
    const container = document.getElementById('posts-container');
    if (!container) {
        console.error('[renderPosts] Container not found!');
        return;
    }
    
    if (!posts || posts.length === 0) {
        console.log('[renderPosts] No posts, showing empty message');
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No posts available yet.</p>';
        return;
    }
    
    console.log('[renderPosts] Rendering', posts.length, 'posts');
    
    // Calculate like_count and dislike_count from arrays if not present
    posts.forEach(post => {
        if (post.like_count === undefined) {
            post.like_count = post.likes ? post.likes.length : 0;
        }
        if (post.dislike_count === undefined) {
            post.dislike_count = post.dislikes ? post.dislikes.length : 0;
        }
    });
    
    const postsHTML = posts.map(post => {
        const isLiked = currentUserId && post.likes && post.likes.includes(currentUserId);
        const likeClass = isLiked ? 'liked' : '';
        
        const avatarHtml = (post.trader_photo && post.trader_photo.trim()) 
            ? `<img src="${post.trader_photo}" class="post-avatar" onerror="this.outerHTML='<div class=\\'post-avatar\\'><i class=\\'fa-solid fa-user\\'></i></div>'" />`
            : `<div class="post-avatar"><i class="fa-solid fa-user"></i></div>`;
        
        const isDisliked = currentUserId && post.dislikes && post.dislikes.includes(currentUserId);
        const dislikeClass = isDisliked ? 'disliked' : '';
        
        return `
            <div class="post-card">
                <div class="post-header">
                    <div class="post-trader">
                        ${avatarHtml}
                        <div class="post-trader-info">
                            <span class="post-trader-name">${post.trader_name}</span>
                            <span class="post-time">${formatTimestamp(post.created_at)}</span>
                        </div>
                    </div>
                </div>
                <div class="post-content">
                    <p>${post.content}</p>
                    ${post.image_url ? `<img src="${post.image_url}" class="post-image" />` : ''}
                </div>
                <div class="post-actions">
                    <button class="post-like-btn ${likeClass}" onclick="likePost('${post.id}')">
                        <i class="fa-${isLiked ? 'solid' : 'regular'} fa-thumbs-up"></i>
                        <span class="like-count">${post.like_count || 0}</span>
                    </button>
                    <button class="post-dislike-btn ${dislikeClass}" onclick="dislikePost('${post.id}')">
                        <i class="fa-${isDisliked ? 'solid' : 'regular'} fa-thumbs-down"></i>
                        <span class="dislike-count">${post.dislike_count || 0}</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `<div class="posts-grid">${postsHTML}</div>`;
}

async function likePost(postId) {
    try {
        const response = await TED_AUTH.apiCall(`/api/traders/posts/${postId}/like`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to like post');
        }
        
        const result = await response.json();
        
        if (postsCache) {
            const post = postsCache.find(p => p.id === postId);
            if (post) {
                if (result.action === 'liked') {
                    post.likes = post.likes || [];
                    post.likes.push(currentUserId);
                    // Remove from dislikes if present
                    if (post.dislikes && post.dislikes.includes(currentUserId)) {
                        post.dislikes = post.dislikes.filter(id => id !== currentUserId);
                    }
                } else {
                    post.likes = post.likes || [];
                    post.likes = post.likes.filter(id => id !== currentUserId);
                }
                post.like_count = result.like_count;
                post.dislike_count = post.dislikes ? post.dislikes.length : 0;
            }
        }
        
        renderPosts(postsCache);
        
    } catch (error) {
        console.error('Error liking post:', error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message
            });
        }
    }
}

async function dislikePost(postId) {
    try {
        const response = await TED_AUTH.apiCall(`/api/traders/posts/${postId}/dislike`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to dislike post');
        }
        
        const result = await response.json();
        
        if (postsCache) {
            const post = postsCache.find(p => p.id === postId);
            if (post) {
                if (result.action === 'disliked') {
                    post.dislikes = post.dislikes || [];
                    post.dislikes.push(currentUserId);
                    // Remove from likes if present
                    if (post.likes && post.likes.includes(currentUserId)) {
                        post.likes = post.likes.filter(id => id !== currentUserId);
                    }
                } else {
                    post.dislikes = post.dislikes || [];
                    post.dislikes = post.dislikes.filter(id => id !== currentUserId);
                }
                post.dislike_count = result.dislike_count;
                post.like_count = post.likes ? post.likes.length : 0;
            }
        }
        
        renderPosts(postsCache);
        
    } catch (error) {
        console.error('Error disliking post:', error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message
            });
        }
    }
}

/**
 * Track/untrack trader
 */
async function trackTrader(traderId, traderName) {
    try {
        const userData = TED_AUTH.getUser();
        const trackedTraders = userData?.tracked_traders || [];
        const isTracked = trackedTraders.includes(traderId);

        if (isTracked) {
            const result = await Swal.fire({
                title: 'Stop Tracking',
                text: `Stop tracking ${traderName}?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            });
            if (!result.isConfirmed) return;

            TED_AUTH.showLoading('Removing from tracking...');
            await TED_AUTH.apiCall(`/api/traders/untrack/${traderId}`, {
                method: 'DELETE'
            });
        } else {
            TED_AUTH.showLoading('Adding to tracking...');
            await TED_AUTH.apiCall(`/api/traders/track/${traderId}`, {
                method: 'POST'
            });
        }

        await TED_AUTH.refreshUserData();
        loadTraders(true);
        TED_AUTH.showSuccess(isTracked ? 'Removed from tracking' : 'Added to tracking');
    } catch (error) {
        console.error('Error tracking trader:', error);
        TED_AUTH.showError('Failed to update tracking');
    }
}

/**
 * Toggle trader strip expansion
 */
function toggleTraderStrip(traderId) {
    const strip = document.querySelector(`.trader-strip[data-trader-id="${traderId}"]`);
    const content = document.getElementById(`trader-content-${traderId}`);
    const chevron = strip.querySelector('.trader-strip-chevron i');
    
    const isExpanded = content.classList.contains('expanded');
    content.classList.toggle('expanded');
    chevron.classList.toggle('fa-chevron-down');
    chevron.classList.toggle('fa-chevron-up');
}

/**
 * Handle copy trader action - select/unselect trader for copying
 */
async function copyTrader(traderId, traderName) {
    try {
        // Get current user data to check if trader is already selected
        const userData = TED_AUTH.getUser();
        const selectedTraders = userData?.selected_traders || [];
        const isSelected = selectedTraders.includes(traderId);

        if (isSelected) {
            // Unselect trader
            if (!(await Swal.fire({
                title: 'Confirm Action',
                text: `Stop copying ${traderName}?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
                return;
            }

            TED_AUTH.showLoading('Unselecting trader...');

            const response = await TED_AUTH.apiCall(`/api/traders/unselect/${traderId}`, {
                method: 'DELETE'
            });

            TED_AUTH.closeLoading();

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to unselect trader');
            }

            const result = await response.json();

            // Update user data
            const freshUserData = await TED_AUTH.fetchCurrentUser();
            if (freshUserData.success) {
                TED_AUTH.saveUser(freshUserData.data);
            }

            // Reload traders to update button state
            await loadExpertTraders(true);

            Swal.fire({ title: 'Success!', html: `Successfully stopped copying ${traderName}.<br>You now have ${result.selected_traders_count} trader(s) selected.`, icon: 'success' });

        } else {
            // Select trader
            if (!(await Swal.fire({
                title: 'Confirm Action',
                text: `Start copying ${traderName}?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
                return;
            }

            TED_AUTH.showLoading('Selecting trader...');

            const response = await TED_AUTH.apiCall(`/api/traders/select/${traderId}`, {
                method: 'POST'
            });

            TED_AUTH.closeLoading();

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to select trader');
            }

            const result = await response.json();

            // Update user data
            const freshUserData = await TED_AUTH.fetchCurrentUser();
            if (freshUserData.success) {
                TED_AUTH.saveUser(freshUserData.data);
            }

            // Reload traders to update button state
            await loadExpertTraders(true);

            Swal.fire({ title: 'Success!', html: `Successfully started copying ${traderName}!<br>You now have ${result.selected_traders_count} trader(s) selected.`, icon: 'success' });
        }

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Error copying/uncopying trader:', error);
        Swal.fire({ title: 'Error!', text: `Error: ${error.message}`, icon: 'error' });
    }
}

/**
 * Load and display investment plans from API
 */
let plansLoaded = false; // Flag to prevent multiple loads
let plansCache = null; // Cache plans data
let userWalletBalance = 0; // Store user's wallet balance

async function loadInvestmentPlans(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (plansLoaded && !forceReload && plansCache) {
        // Display cached plans
        console.log('Displaying cached plans:', plansCache.length);
        displayPlans(plansCache);
        return;
    }

    const container = document.getElementById('plans-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading investment plans...</p>';

    try {
        console.log('Starting to load investment plans...');

        // Check authentication
        const token = TED_AUTH.getToken();
        if (!token) {
            console.error('No authentication token found');
            throw new Error('Please login to view investment plans');
        }
        console.log('Authentication token found');

        // Fetch user data to get wallet balance
        const userData = TED_AUTH.getUser();
        console.log('User data from localStorage:', userData);

        if (!userData || userData.wallet_balance === undefined || userData.wallet_balance === null) {
            // Try to fetch fresh user data
            console.log('Fetching fresh user data from /api/auth/me...');
            const userResponse = await TED_AUTH.apiCall('/api/auth/me');
            console.log('User data response status:', userResponse.status);

            if (userResponse.ok) {
                const freshUserData = await userResponse.json();
                console.log('Fresh user data:', freshUserData);
                userWalletBalance = freshUserData.wallet_balance !== undefined ? freshUserData.wallet_balance : 0;
                TED_AUTH.saveUser(freshUserData);
            } else {
                console.warn('Failed to fetch user data, defaulting wallet balance to 0');
                userWalletBalance = 0;
            }
        } else {
            userWalletBalance = userData.wallet_balance;
        }

        console.log('User wallet balance:', userWalletBalance);

        // Update wallet balance display
        const walletBalanceElement = document.getElementById('wallet-balance');
        if (walletBalanceElement) {
            walletBalanceElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Fetch investment plans from API
        console.log('Fetching investment plans from /api/plans/...');
        const response = await TED_AUTH.apiCall('/api/plans/', {
            method: 'GET'
        });

        console.log('Plans API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Plans API error:', errorData);
            throw new Error(errorData.detail || `Failed to fetch investment plans: ${response.statusText}`);
        }

        const plans = await response.json();
        console.log('Successfully fetched plans:', plans.length, plans);

        // Cache the plans
        plansCache = plans;
        plansLoaded = true;

        // Display plans
        displayPlans(plans);
    } catch (error) {
        console.error('Error loading investment plans:', error);
        console.error('Error stack:', error.stack);
        plansLoaded = false; // Reset flag so user can retry
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 0;">
                <p style="color: #ff6b6b; margin-bottom: 15px;">
                    <i class="fa fa-exclamation-circle" style="font-size: 24px; margin-bottom: 10px;"></i><br>
                    Failed to load investment plans
                </p>
                <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">${error.message}</p>
                <p style="color: #8b93a7; font-size: 12px; margin-bottom: 20px;">Check browser console for details</p>
                <button class="btn-primary-custom" onclick="loadInvestmentPlans(true)">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
        `;
    }
}

/**
 * Display plans in the container
 */
function displayPlans(plans) {
    const container = document.getElementById('plans-container');

    if (plans.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No investment plans available at the moment.</p>';
        return;
    }

    container.innerHTML = '';
    plans.forEach(plan => {
        const planCard = createPlanCard(plan);
        container.appendChild(planCard);
    });
}

function showPlanDetailModal(plan, type) {
    const modal = document.getElementById('plan-detail-modal');
    const body = document.getElementById('plan-detail-modal-body');

    const hasSufficientFunds = userWalletBalance >= plan.minimum_investment;
    const potentialProfit = (plan.minimum_investment * plan.expected_return_percent / 100).toFixed(2);
    const safeName = escapeHtml(plan.name || '');
    const safeDesc = escapeHtml(plan.description || '');
    const escapedNameForAttr = (plan.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    let badgeHtml = '';
    if (type === 'etf' || type === 'defi' || type === 'options') {
        let badgeColor = '#667eea';
        const planType = plan.plan_type || plan.portfolio_type || '';
        if (planType === 'Conservative' || planType === 'Beginner') badgeColor = '#4caf50';
        else if (planType === 'Moderate' || planType === 'Intermediate') badgeColor = '#ff9800';
        else if (planType === 'Aggressive' || planType === 'Advanced') badgeColor = '#f44336';
        else if (planType === 'Balanced') badgeColor = '#667eea';
        else if (planType === 'Expert') badgeColor = '#764ba2';
        badgeHtml = `<span style="background: ${badgeColor}; color: white; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 600;">${escapeHtml(planType)}</span>`;
    }

    let statsBg = 'rgba(123, 182, 218, 0.05)';
    if (type === 'etf' || type === 'options') statsBg = 'rgba(102, 126, 234, 0.08)';
    else if (type === 'defi') statsBg = 'rgba(17, 153, 142, 0.08)';

    const durationValue = plan.holding_period_months || plan.duration_months || 0;
    const durationLabel = type === 'general' ? 'Holding Period' : 'Duration';
    const durationText = durationValue > 0 ? `${durationValue} mo` : 'Ongoing';

    let infoHtml = '';
    if (type === 'general') {
        infoHtml = `
            <div style="padding: 12px; background: ${statsBg}; border-radius: 8px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #8b93a7; font-size: 13px;">Profit:</span>
                    <span style="color: #4caf50; font-weight: 600; font-size: 13px;">$${parseFloat(potentialProfit).toLocaleString()}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #8b93a7; font-size: 13px;">Subscribers:</span>
                    <span style="color: #000; font-weight: 600; font-size: 13px;">${(plan.current_subscribers || 0).toLocaleString()}</span>
                </div>
            </div>`;
    } else {
        infoHtml = `
            <div style="padding: 12px; background: ${statsBg}; border-radius: 8px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #8b93a7; font-size: 13px;">Minimum Investment:</span>
                    <span style="color: #D32F2F; font-weight: 700; font-size: 16px;">$${plan.minimum_investment.toLocaleString()}</span>
                </div>
            </div>`;
    }

    let warningHtml = '';
    if (!hasSufficientFunds && plan.minimum_investment > 0) {
        warningHtml = `
            <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; padding: 10px; margin-bottom: 16px;">
                <p style="color: #ff6b6b; font-size: 13px; margin: 0;">
                    <i class="fa fa-exclamation-triangle"></i> Need $${(plan.minimum_investment - userWalletBalance).toLocaleString()} more to invest in this plan
                </p>
            </div>`;
    }

    let buttonHtml = '';
    const buttonDisabled = !hasSufficientFunds;
    if (type === 'general') {
        buttonHtml = `
            <button class="btn-success-custom" style="width: 100%; padding: 12px; font-size: 14px;"
                ${buttonDisabled ? 'disabled' : ''}
                ${!buttonDisabled ? `onclick="investInPlan('${plan.id}', '${escapedNameForAttr}', ${plan.minimum_investment}); closePlanDetailModal();"` : ''}>
                ${hasSufficientFunds ? '<i class="fa fa-check-circle"></i> Invest Now' : '<i class="fa fa-lock"></i> Insufficient Funds'}
            </button>`;
    } else {
        let activateFn = '';
        let btnGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        if (type === 'etf') { activateFn = 'activateETFPlan'; btnGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; }
        else if (type === 'defi') { activateFn = 'activateDeFiPlan'; btnGradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'; }
        else if (type === 'options') { activateFn = 'activateOptionsPlan'; btnGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; }
        buttonHtml = `
            <button class="activate-plan-btn" style="width: 100%; padding: 12px; background: ${buttonDisabled ? '#ccc' : btnGradient}; color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; transition: all 0.3s;"
                ${buttonDisabled ? 'disabled' : ''}
                ${!buttonDisabled ? `onclick="${activateFn}('${plan.id}', '${escapedNameForAttr}', ${plan.minimum_investment}); closePlanDetailModal();"` : ''}>
                <i class="fa fa-rocket"></i> ${hasSufficientFunds ? 'Activate Plan' : 'Insufficient Funds'}
            </button>`;
    }

    body.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <h2 style="margin: 0; color: #D32F2F; font-size: 20px;">${safeName}</h2>
                ${badgeHtml}
            </div>
            <button onclick="closePlanDetailModal()" style="background: transparent; border: none; color: #8b93a7; font-size: 22px; cursor: pointer; padding: 0; width: 32px; height: 32px; line-height: 32px; text-align: center;">&times;</button>
        </div>

        <div style="margin-bottom: 20px;">
            <div style="font-size: 28px; font-weight: bold; color: #D32F2F;">$${plan.minimum_investment.toLocaleString()}</div>
            <div style="font-size: 13px; color: #8b93a7;">Minimum Investment</div>
        </div>

        ${safeDesc ? `<p style="color: #8b93a7; margin-bottom: 20px; line-height: 1.6; font-size: 14px;">${safeDesc}</p>` : ''}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; padding: 16px; background: ${statsBg}; border-radius: 8px;">
            <div>
                <div style="font-size: 22px; font-weight: bold; color: #4caf50;">${plan.expected_return_percent}%</div>
                <div style="font-size: 12px; color: #8b93a7;">Expected Return</div>
            </div>
            <div>
                <div style="font-size: 22px; font-weight: bold; color: #D32F2F;">${durationText}</div>
                <div style="font-size: 12px; color: #8b93a7;">${durationLabel}</div>
            </div>
        </div>

        ${infoHtml}
        ${warningHtml}
        ${buttonHtml}
    `;

    modal.style.display = 'flex';
}

function closePlanDetailModal() {
    document.getElementById('plan-detail-modal').style.display = 'none';
}

document.getElementById('plan-detail-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closePlanDetailModal();
    }
});

/**
 * Create a plan card element
 */
function createPlanCard(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card';

    // Check if user has sufficient funds
    const hasSufficientFunds = userWalletBalance >= plan.minimum_investment;
    const buttonDisabled = !hasSufficientFunds;

    // Add visual indicator for unaffordable plans
    if (!hasSufficientFunds) {
        card.style.opacity = '0.85';
    }

    // Calculate potential profit
    const potentialProfit = (plan.minimum_investment * plan.expected_return_percent / 100).toFixed(2);

    card.innerHTML = `
        <h3 style="color: #D32F2F; margin-bottom: 8px;">${plan.name}</h3>

        <div style="margin: 10px 0;">
            <div class="plan-min-amount" style="font-size: 24px; font-weight: bold; color: #D32F2F;">$${plan.minimum_investment.toLocaleString()}</div>
            <div style="font-size: 11px; color: #8b93a7;">Minimum Investment</div>
        </div>

        <p style="color: #8b93a7; margin-bottom: 10px; line-height: 1.4; font-size: 12px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${plan.description}</p>

        <div class="plan-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; padding: 10px; background: rgba(123, 182, 218, 0.05); border-radius: 6px;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #4caf50;">${plan.expected_return_percent}%</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Expected Return</div>
            </div>
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #D32F2F;">${plan.holding_period_months} mo</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Holding Period</div>
            </div>
        </div>

        <div class="plan-info" style="padding: 8px; background: rgba(123, 182, 218, 0.05); border-radius: 6px; margin-bottom: 10px;">
            <div class="plan-info-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Profit:</span>
                <span style="color: #4caf50; font-weight: 600; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">$${parseFloat(potentialProfit).toLocaleString()}</span>
            </div>
            <div class="plan-info-row" style="display: flex; justify-content: space-between;">
                <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Subscribers:</span>
                <span style="color: #000; font-weight: 600; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${plan.current_subscribers.toLocaleString()}</span>
            </div>
        </div>

        ${!hasSufficientFunds ? `
            <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 6px; padding: 6px; margin-bottom: 8px;">
                <p style="color: #ff6b6b; font-size: 11px; margin: 0;">
                    <i class="fa fa-exclamation-triangle"></i> Need $${(plan.minimum_investment - userWalletBalance).toLocaleString()} more
                </p>
            </div>
        ` : ''}

        <button
            class="btn-success-custom"
            style="width: 100%; margin-top: 6px; ${buttonDisabled ? 'pointer-events: none;' : ''}"
            ${buttonDisabled ? 'disabled' : ''}
            ${!buttonDisabled ? `onclick="investInPlan('${plan.id}', '${plan.name}', ${plan.minimum_investment})"` : ''}
        >
            ${hasSufficientFunds ? '<i class="fa fa-check-circle"></i> Invest' : '<i class="fa fa-lock"></i> Insufficient'}
        </button>
    `;

    return card;
}

/**
 * Handle invest in plan action
 */
async function investInPlan(planId, planName, minimumInvestment) {
    // Confirm investment
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: `Invest in ${planName}?\n\nMinimum Investment: $${minimumInvestment.toLocaleString()}\n\nThis amount will be deducted from your wallet.`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
        return;
    }

    try {
        TED_AUTH.showLoading('Processing your investment...');

        const response = await TED_AUTH.apiCall('/api/investments/invest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                plan_id: planId,
                amount: minimumInvestment
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            TED_AUTH.closeLoading();

            // Check if error is about trader selection
            if (error.detail && error.detail.includes('select at least 1 trader')) {
                Swal.fire({ title: 'Error!', html: `Unable to invest: ${error.detail}`, icon: 'error' });

                // Navigate to traders tab
                document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
                const tradersTab = document.querySelector('.menu-item[data-tab="traders"]');
                if (tradersTab) {
                    tradersTab.classList.add('active');
                    tradersTab.click();
                }
                return;
            }

            throw new Error(error.detail || 'Investment failed');
        }

        const result = await response.json();

        // Update wallet balance
        userWalletBalance = result.new_wallet_balance;
        document.getElementById('wallet-balance').textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        // Update user data in localStorage
        const userData = TED_AUTH.getUser();
        if (userData) {
            userData.wallet_balance = result.new_wallet_balance;
            TED_AUTH.saveUser(userData);
        }

        // Reload investment plans to update balances
        await loadInvestmentPlans(true);

        // Show success message and navigate to portfolio
        Swal.fire({ title: 'Success!', html: `Investment successful!<br><br>Invested: $${result.amount_invested.toLocaleString()}<br>Plan: ${result.plan_name}<br>Maturity Date: ${new Date(result.maturity_date).toLocaleDateString()}<br><br>View your investment in the Portfolio tab.`, icon: 'success' });

        // Navigate to portfolio tab
        document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
        const portfolioTab = document.querySelector('.menu-item[data-tab="portfolio"]');
        if (portfolioTab) {
            portfolioTab.classList.add('active');
            portfolioTab.click();
        }

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Investment error:', error);
        Swal.fire({ title: 'Error!', text: `Investment failed: ${error.message}`, icon: 'error' });
    }
}

// ==============================================
// ETF PLANS MANAGEMENT
// ==============================================

let etfPlansLoaded = false; // Flag to prevent multiple loads
let etfPlansCache = null; // Cache for ETF plans data

/**
 * Load ETF plans
 */
async function loadETFPlans(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (etfPlansLoaded && !forceReload && etfPlansCache) {
        console.log('Displaying cached ETF plans:', etfPlansCache.length);
        displayETFPlans(etfPlansCache);
        return;
    }

    const container = document.getElementById('etf-plans-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading ETF plans...</p>';

    try {
        console.log('Starting to load ETF plans...');

        // Check authentication
        const token = TED_AUTH.getToken();
        if (!token) {
            console.error('No authentication token found');
            throw new Error('Please login to view ETF plans');
        }

        // Fetch user data to get wallet balance
        const userData = TED_AUTH.getUser();
        if (!userData || userData.wallet_balance === undefined || userData.wallet_balance === null) {
            const userResponse = await TED_AUTH.apiCall('/api/auth/me');
            if (userResponse.ok) {
                const freshUserData = await userResponse.json();
                userWalletBalance = freshUserData.wallet_balance !== undefined ? freshUserData.wallet_balance : 0;
                TED_AUTH.saveUser(freshUserData);
            } else {
                userWalletBalance = 0;
            }
        } else {
            userWalletBalance = userData.wallet_balance;
        }

        // Update wallet balance display
        const etfWalletBalanceElement = document.getElementById('etf-wallet-balance');
        if (etfWalletBalanceElement) {
            etfWalletBalanceElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Fetch ETF plans from API
        console.log('Fetching ETF plans from /api/etf-plans/...');
        const response = await TED_AUTH.apiCall('/api/etf-plans/', {
            method: 'GET'
        });

        console.log('ETF Plans API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('ETF Plans API error:', errorData);
            throw new Error(errorData.detail || `Failed to fetch ETF plans: ${response.statusText}`);
        }

        const etfPlans = await response.json();
        console.log('Successfully fetched ETF plans:', etfPlans.length, etfPlans);

        // Cache the ETF plans
        etfPlansCache = etfPlans;
        etfPlansLoaded = true;

        // Display ETF plans
        displayETFPlans(etfPlans);
    } catch (error) {
        console.error('Error loading ETF plans:', error);
        etfPlansLoaded = false;
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 0;">
                <p style="color: #ff6b6b; margin-bottom: 15px;">
                    <i class="fa fa-exclamation-circle" style="font-size: 24px; margin-bottom: 10px;"></i><br>
                    Failed to load ETF plans
                </p>
                <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">${error.message}</p>
                <button class="btn-primary-custom" onclick="loadETFPlans(true)">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
        `;
    }
}

/**
 * Display ETF plans in the container
 */
function displayETFPlans(etfPlans) {
    const container = document.getElementById('etf-plans-container');

    if (etfPlans.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No ETF plans available at the moment.</p>';
        return;
    }

    container.innerHTML = '';
    etfPlans.forEach(plan => {
        const planCard = createETFPlanCard(plan);
        container.appendChild(planCard);
    });
}

/**
 * Create an ETF plan card element
 */
function createETFPlanCard(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card';

    // Check if user has sufficient funds
    const hasSufficientFunds = userWalletBalance >= plan.minimum_investment;
    const buttonDisabled = !hasSufficientFunds;

    // Add visual indicator for unaffordable plans
    if (!hasSufficientFunds) {
        card.style.opacity = '0.85';
    }

    // Plan type badge color
    let badgeColor = '#667eea';
    if (plan.plan_type === 'Conservative') {
        badgeColor = '#4caf50';
    } else if (plan.plan_type === 'Moderate') {
        badgeColor = '#ff9800';
    } else if (plan.plan_type === 'Aggressive') {
        badgeColor = '#f44336';
    }

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="color: #D32F2F; margin: 0; font-size: 14px;">${plan.name}</h3>
            <span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600;">
                ${plan.plan_type}
            </span>
        </div>

        ${plan.description ? `<p style="color: #8b93a7; margin-bottom: 10px; line-height: 1.4; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${plan.description}</p>` : ''}

        <div class="plan-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; padding: 10px; background: rgba(102, 126, 234, 0.08); border-radius: 6px;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #4caf50;">${plan.expected_return_percent}%</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Return</div>
            </div>
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #D32F2F;">${plan.duration_months} mo</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Duration</div>
            </div>
        </div>

        ${plan.minimum_investment > 0 ? `
            <div class="plan-info" style="padding: 8px; background: rgba(102, 126, 234, 0.08); border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Min:</span>
                    <span style="color: #D32F2F; font-weight: 700; font-size: 14px;">$${plan.minimum_investment.toLocaleString()}</span>
                </div>
            </div>
        ` : ''}

        ${!hasSufficientFunds && plan.minimum_investment > 0 ? `
            <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 6px; padding: 6px; margin-bottom: 8px;">
                <p style="color: #ff6b6b; font-size: 10px; margin: 0;">
                    <i class="fa fa-exclamation-triangle"></i> Need $${(plan.minimum_investment - userWalletBalance).toLocaleString()} more
                </p>
            </div>
        ` : ''}

        <button
            class="activate-plan-btn"
            onclick="activateETFPlan('${plan.id}', '${plan.name}', ${plan.minimum_investment})"
            ${buttonDisabled ? 'disabled' : ''}
            style="width: 100%; padding: 8px; background: ${buttonDisabled ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; transition: all 0.3s;"
        >
            <i class="fa fa-rocket"></i> Activate
        </button>
    `;

    return card;
}

/**
 * Activate an ETF plan
 */
async function activateETFPlan(planId, planName, minInvestment) {
    const { value: amount } = await Swal.fire({
        title: `Activate ${planName}`,
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                Enter the amount you wish to invest in this ETF plan.
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 10px;">
                Minimum Investment: <strong>$${minInvestment.toLocaleString()}</strong>
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">
                Your Wallet Balance: <strong>$${userWalletBalance.toLocaleString()}</strong>
            </p>
        `,
        input: 'number',
        inputPlaceholder: `Enter amount (min $${minInvestment})`,
        inputAttributes: {
            min: minInvestment,
            step: '0.01'
        },
        showCancelButton: true,
        confirmButtonText: 'Activate Plan',
        cancelButtonText: 'Cancel',
        inputValidator: (value) => {
            if (!value || parseFloat(value) < minInvestment) {
                return `Amount must be at least $${minInvestment}`;
            }
            if (parseFloat(value) > userWalletBalance) {
                return 'Insufficient wallet balance';
            }
        }
    });

    if (!amount) return;

    try {
        TED_AUTH.showLoading('Activating your ETF plan...');

        const response = await TED_AUTH.apiCall(`/api/etf-plans/activate/${planId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                plan_id: planId,
                amount: parseFloat(amount)
            })
        });

        TED_AUTH.closeLoading();

        const data = await response.json();

        if (!response.ok) {
            TED_AUTH.closeLoading();

            // Check if error is about trader selection
            if (data.detail && data.detail.includes('select at least 1 trader')) {
                Swal.fire({
                    title: 'Error!',
                    html: `Unable to activate plan: ${data.detail}`,
                    icon: 'error'
                });

                // Navigate to traders tab
                document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
                const tradersTab = document.querySelector('.menu-item[data-tab="traders"]');
                if (tradersTab) {
                    tradersTab.classList.add('active');
                    tradersTab.click();
                }
                return;
            }

            throw new Error(data.detail || 'Failed to activate plan');
        }

        // Update wallet balance
        userWalletBalance = data.new_wallet_balance;
        updateWalletDisplay();

        // Show success message
        await Swal.fire({
            title: 'Plan Activated!',
            html: `
                <p style="color: #4caf50; font-weight: 600; margin-bottom: 15px;">
                    Successfully activated ${planName}
                </p>
                <div style="text-align: left; background: rgba(102, 126, 234, 0.08); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <p style="margin: 5px 0;"><strong>Amount Invested:</strong> $${parseFloat(amount).toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>New Wallet Balance:</strong> $${data.new_wallet_balance.toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>Maturity Date:</strong> ${new Date(data.maturity_date).toLocaleDateString()}</p>
                </div>
                <p style="color: #8b93a7; font-size: 14px;">
                    <i class="fa fa-info-circle"></i> View your active plan in the Portfolio tab
                </p>
            `,
            icon: 'success',
            confirmButtonText: 'OK'
        });

        // Refresh portfolio to show new investment
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData();
        }

    } catch (error) {
        Swal.fire({
            title: 'Activation Failed',
            text: error.message,
            icon: 'error',
            confirmButtonText: 'OK'
        });
    }
}

/**
 * Show ETF plan details
 */
async function showETFPlanDetails(planId) {
    Swal.fire({
        title: 'ETF Plan Details',
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                ETF investment functionality is currently being implemented.
            </p>
            <p style="color: #8b93a7; font-size: 14px;">
                <i class="fa fa-info-circle"></i> Contact support for more information about investing in this ETF plan.
            </p>
        `,
        icon: 'info',
        confirmButtonText: 'OK'
    });
}

// ==============================================
// DEFI PLANS MANAGEMENT
// ==============================================

let defiPlansLoaded = false; // Flag to prevent multiple loads
let defiPlansCache = null; // Cache for DeFi plans data

/**
 * Load DeFi plans
 */
async function loadDeFiPlans(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (defiPlansLoaded && !forceReload && defiPlansCache) {
        console.log('Displaying cached DeFi plans:', defiPlansCache.length);
        displayDeFiPlans(defiPlansCache);
        return;
    }

    const container = document.getElementById('defi-plans-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading DeFi plans...</p>';

    try {
        console.log('Starting to load DeFi plans...');

        // Check authentication
        const token = TED_AUTH.getToken();
        if (!token) {
            console.error('No authentication token found');
            throw new Error('Please login to view DeFi plans');
        }

        // Fetch user data to get wallet balance
        const userData = TED_AUTH.getUser();
        if (!userData || userData.wallet_balance === undefined || userData.wallet_balance === null) {
            const userResponse = await TED_AUTH.apiCall('/api/auth/me');
            if (userResponse.ok) {
                const freshUserData = await userResponse.json();
                userWalletBalance = freshUserData.wallet_balance !== undefined ? freshUserData.wallet_balance : 0;
                TED_AUTH.saveUser(freshUserData);
            } else {
                userWalletBalance = 0;
            }
        } else {
            userWalletBalance = userData.wallet_balance;
        }

        // Update wallet balance display
        const defiWalletBalanceElement = document.getElementById('defi-wallet-balance');
        if (defiWalletBalanceElement) {
            defiWalletBalanceElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Fetch DeFi plans from API
        console.log('Fetching DeFi plans from /api/defi-plans/...');
        const response = await TED_AUTH.apiCall('/api/defi-plans/', {
            method: 'GET'
        });

        console.log('DeFi Plans API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('DeFi Plans API error:', errorData);
            throw new Error(errorData.detail || `Failed to fetch DeFi plans: ${response.statusText}`);
        }

        const defiPlans = await response.json();
        console.log('Successfully fetched DeFi plans:', defiPlans.length, defiPlans);

        // Cache the DeFi plans
        defiPlansCache = defiPlans;
        defiPlansLoaded = true;

        // Display DeFi plans
        displayDeFiPlans(defiPlans);
    } catch (error) {
        console.error('Error loading DeFi plans:', error);
        defiPlansLoaded = false;
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 0;">
                <p style="color: #ff6b6b; margin-bottom: 15px;">
                    <i class="fa fa-exclamation-circle" style="font-size: 24px; margin-bottom: 10px;"></i><br>
                    Failed to load DeFi plans
                </p>
                <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">${error.message}</p>
                <button class="btn-primary-custom" onclick="loadDeFiPlans(true)">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
        `;
    }
}

/**
 * Display DeFi plans in the container
 */
function displayDeFiPlans(defiPlans) {
    const container = document.getElementById('defi-plans-container');

    if (defiPlans.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No DeFi plans available at the moment.</p>';
        return;
    }

    container.innerHTML = '';
    defiPlans.forEach(plan => {
        const planCard = createDeFiPlanCard(plan);
        container.appendChild(planCard);
    });
}

/**
 * Create a DeFi plan card element
 */
function createDeFiPlanCard(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card';

    // Check if user has sufficient funds
    const hasSufficientFunds = userWalletBalance >= plan.minimum_investment;
    const buttonDisabled = !hasSufficientFunds;

    // Add visual indicator for unaffordable plans
    if (!hasSufficientFunds) {
        card.style.opacity = '0.85';
    }

    // Portfolio type badge color
    let badgeColor = '#11998e';
    if (plan.portfolio_type === 'Conservative') {
        badgeColor = '#4caf50';
    } else if (plan.portfolio_type === 'Moderate') {
        badgeColor = '#ff9800';
    } else if (plan.portfolio_type === 'Aggressive') {
        badgeColor = '#f44336';
    } else if (plan.portfolio_type === 'Balanced') {
        badgeColor = '#667eea';
    }

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="color: #D32F2F; margin: 0; font-size: 14px;">${plan.name}</h3>
            <span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600;">
                ${plan.portfolio_type}
            </span>
        </div>

        ${plan.description ? `<p style="color: #8b93a7; margin-bottom: 10px; line-height: 1.4; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${plan.description}</p>` : ''}

        <div class="plan-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; padding: 10px; background: rgba(17, 153, 142, 0.08); border-radius: 6px;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #4caf50;">${plan.expected_return_percent}%</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Return</div>
            </div>
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #D32F2F;">${plan.duration_months} mo</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Duration</div>
            </div>
        </div>

        ${plan.minimum_investment > 0 ? `
            <div class="plan-info" style="padding: 8px; background: rgba(17, 153, 142, 0.08); border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Min:</span>
                    <span style="color: #D32F2F; font-weight: 700; font-size: 14px;">$${plan.minimum_investment.toLocaleString()}</span>
                </div>
            </div>
        ` : ''}

        ${!hasSufficientFunds && plan.minimum_investment > 0 ? `
            <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 6px; padding: 6px; margin-bottom: 8px;">
                <p style="color: #ff6b6b; font-size: 10px; margin: 0;">
                    <i class="fa fa-exclamation-triangle"></i> Need $${(plan.minimum_investment - userWalletBalance).toLocaleString()} more
                </p>
            </div>
        ` : ''}

        <button
            class="activate-plan-btn"
            onclick="activateDeFiPlan('${plan.id}', '${plan.name}', ${plan.minimum_investment})"
            ${buttonDisabled ? 'disabled' : ''}
            style="width: 100%; padding: 8px; background: ${buttonDisabled ? '#ccc' : 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'}; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; transition: all 0.3s;"
        >
            <i class="fa fa-rocket"></i> Activate
        </button>
    `;

    return card;
}

/**
 * Activate a DeFi plan
 */
async function activateDeFiPlan(planId, planName, minInvestment) {
    const { value: amount } = await Swal.fire({
        title: `Activate ${planName}`,
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                Enter the amount you wish to invest in this DeFi plan.
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 10px;">
                Minimum Investment: <strong>$${minInvestment.toLocaleString()}</strong>
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">
                Your Wallet Balance: <strong>$${userWalletBalance.toLocaleString()}</strong>
            </p>
        `,
        input: 'number',
        inputPlaceholder: `Enter amount (min $${minInvestment})`,
        inputAttributes: {
            min: minInvestment,
            step: '0.01'
        },
        showCancelButton: true,
        confirmButtonText: 'Activate Plan',
        cancelButtonText: 'Cancel',
        inputValidator: (value) => {
            if (!value || parseFloat(value) < minInvestment) {
                return `Amount must be at least $${minInvestment}`;
            }
            if (parseFloat(value) > userWalletBalance) {
                return 'Insufficient wallet balance';
            }
        }
    });

    if (!amount) return;

    try {
        TED_AUTH.showLoading('Activating your DeFi plan...');

        const response = await TED_AUTH.apiCall(`/api/defi-plans/activate/${planId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                plan_id: planId,
                amount: parseFloat(amount)
            })
        });

        TED_AUTH.closeLoading();

        const data = await response.json();

        if (!response.ok) {
            TED_AUTH.closeLoading();

            // Check if error is about trader selection
            if (data.detail && data.detail.includes('select at least 1 trader')) {
                Swal.fire({
                    title: 'Error!',
                    html: `Unable to activate plan: ${data.detail}`,
                    icon: 'error'
                });

                // Navigate to traders tab
                document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
                const tradersTab = document.querySelector('.menu-item[data-tab="traders"]');
                if (tradersTab) {
                    tradersTab.classList.add('active');
                    tradersTab.click();
                }
                return;
            }

            throw new Error(data.detail || 'Failed to activate plan');
        }

        // Update wallet balance
        userWalletBalance = data.new_wallet_balance;
        updateWalletDisplay();

        // Show success message
        await Swal.fire({
            title: 'Plan Activated!',
            html: `
                <p style="color: #4caf50; font-weight: 600; margin-bottom: 15px;">
                    Successfully activated ${planName}
                </p>
                <div style="text-align: left; background: rgba(17, 153, 142, 0.08); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <p style="margin: 5px 0;"><strong>Amount Invested:</strong> $${parseFloat(amount).toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>New Wallet Balance:</strong> $${data.new_wallet_balance.toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>Maturity Date:</strong> ${new Date(data.maturity_date).toLocaleDateString()}</p>
                </div>
                <p style="color: #8b93a7; font-size: 14px;">
                    <i class="fa fa-info-circle"></i> View your active plan in the Portfolio tab
                </p>
            `,
            icon: 'success',
            confirmButtonText: 'OK'
        });

        // Refresh portfolio to show new investment
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData();
        }

    } catch (error) {
        Swal.fire({
            title: 'Activation Failed',
            text: error.message,
            icon: 'error',
            confirmButtonText: 'OK'
        });
    }
}

/**
 * Show DeFi plan details
 */
async function showDeFiPlanDetails(planId) {
    Swal.fire({
        title: 'DeFi Plan Details',
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                DeFi copy trading functionality is currently being implemented.
            </p>
            <p style="color: #8b93a7; font-size: 14px;">
                <i class="fa fa-info-circle"></i> Contact support for more information about copying trades from professional DeFi traders.
            </p>
        `,
        icon: 'info',
        confirmButtonText: 'OK'
    });
}

// ==============================================
// OPTIONS PLANS MANAGEMENT
// ==============================================

let optionsPlansLoaded = false; // Flag to prevent multiple loads
let optionsPlansCache = null; // Cache for Options plans data

/**
 * Load Options plans
 */
async function loadOptionsPlans(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (optionsPlansLoaded && !forceReload && optionsPlansCache) {
        console.log('Displaying cached Options plans:', optionsPlansCache.length);
        displayOptionsPlans(optionsPlansCache);
        return;
    }

    const container = document.getElementById('options-plans-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading Options plans...</p>';

    try {
        console.log('Starting to load Options plans...');

        // Check authentication
        const token = TED_AUTH.getToken();
        if (!token) {
            console.error('No authentication token found');
            throw new Error('Please login to view Options plans');
        }

        // Fetch user data to get wallet balance
        const userData = TED_AUTH.getUser();
        if (!userData || userData.wallet_balance === undefined || userData.wallet_balance === null) {
            const userResponse = await TED_AUTH.apiCall('/api/auth/me');
            if (userResponse.ok) {
                const freshUserData = await userResponse.json();
                userWalletBalance = freshUserData.wallet_balance !== undefined ? freshUserData.wallet_balance : 0;
                TED_AUTH.saveUser(freshUserData);
            } else {
                userWalletBalance = 0;
            }
        } else {
            userWalletBalance = userData.wallet_balance;
        }

        // Update wallet balance display
        const optionsWalletBalanceElement = document.getElementById('options-wallet-balance');
        if (optionsWalletBalanceElement) {
            optionsWalletBalanceElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Fetch Options plans from API
        console.log('Fetching Options plans from /api/options-plans/...');
        const response = await TED_AUTH.apiCall('/api/options-plans/', {
            method: 'GET'
        });

        console.log('Options Plans API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Options Plans API error:', errorData);
            throw new Error(errorData.detail || `Failed to fetch Options plans: ${response.statusText}`);
        }

        const optionsPlans = await response.json();
        console.log('Successfully fetched Options plans:', optionsPlans.length, optionsPlans);

        // Cache the Options plans
        optionsPlansCache = optionsPlans;
        optionsPlansLoaded = true;

        // Display Options plans
        displayOptionsPlans(optionsPlans);
    } catch (error) {
        console.error('Error loading Options plans:', error);
        optionsPlansLoaded = false;
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 0;">
                <p style="color: #ff6b6b; margin-bottom: 15px;">
                    <i class="fa fa-exclamation-circle" style="font-size: 24px; margin-bottom: 10px;"></i><br>
                    Failed to load Options plans
                </p>
                <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">${error.message}</p>
                <button class="btn-primary-custom" onclick="loadOptionsPlans(true)">
                    <i class="fa fa-refresh"></i> Retry
                </button>
            </div>
        `;
    }
}

/**
 * Display Options plans in the container
 */
function displayOptionsPlans(optionsPlans) {
    const container = document.getElementById('options-plans-container');

    if (optionsPlans.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No Options plans available at the moment.</p>';
        return;
    }

    container.innerHTML = '';
    optionsPlans.forEach(plan => {
        const planCard = createOptionsPlanCard(plan);
        container.appendChild(planCard);
    });
}

/**
 * Create an Options plan card element
 */
function createOptionsPlanCard(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card';

    // Check if user has sufficient funds
    const hasSufficientFunds = userWalletBalance >= plan.minimum_investment;
    const buttonDisabled = !hasSufficientFunds;

    // Add visual indicator for unaffordable plans
    if (!hasSufficientFunds) {
        card.style.opacity = '0.85';
    }

    // Plan type badge color
    let badgeColor = '#667eea';
    if (plan.plan_type === 'Beginner') {
        badgeColor = '#4caf50';
    } else if (plan.plan_type === 'Intermediate') {
        badgeColor = '#ff9800';
    } else if (plan.plan_type === 'Advanced') {
        badgeColor = '#f44336';
    } else if (plan.plan_type === 'Expert') {
        badgeColor = '#764ba2';
    }

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="color: #D32F2F; margin: 0; font-size: 14px;">${plan.name}</h3>
            <span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600;">
                ${plan.plan_type}
            </span>
        </div>

        ${plan.description ? `<p style="color: #8b93a7; margin-bottom: 10px; line-height: 1.4; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${plan.description}</p>` : ''}

        <div class="plan-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; padding: 10px; background: rgba(102, 126, 234, 0.08); border-radius: 6px;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #4caf50;">${plan.expected_return_percent}%</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Return</div>
            </div>
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #D32F2F;">${plan.duration_months > 0 ? plan.duration_months + ' mo' : 'Ongoing'}</div>
                <div class="stat-label" style="font-size: 10px; color: #8b93a7;">Duration</div>
            </div>
        </div>

        ${plan.minimum_investment > 0 ? `
            <div class="plan-info" style="padding: 8px; background: rgba(102, 126, 234, 0.08); border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Min:</span>
                    <span style="color: #D32F2F; font-weight: 700; font-size: 14px;">$${plan.minimum_investment.toLocaleString()}</span>
                </div>
            </div>
        ` : ''}

        ${!hasSufficientFunds && plan.minimum_investment > 0 ? `
            <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 6px; padding: 6px; margin-bottom: 8px;">
                <p style="color: #ff6b6b; font-size: 10px; margin: 0;">
                    <i class="fa fa-exclamation-triangle"></i> Need $${(plan.minimum_investment - userWalletBalance).toLocaleString()} more
                </p>
            </div>
        ` : ''}

        <button
            class="activate-plan-btn"
            onclick="activateOptionsPlan('${plan.id}', '${plan.name}', ${plan.minimum_investment})"
            ${buttonDisabled ? 'disabled' : ''}
            style="width: 100%; padding: 8px; background: ${buttonDisabled ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: ${buttonDisabled ? 'not-allowed' : 'pointer'}; transition: all 0.3s;"
        >
            <i class="fa fa-rocket"></i> Activate
        </button>
    `;

    return card;
}

/**
 * Activate an Options plan
 */
async function activateOptionsPlan(planId, planName, minInvestment) {
    const { value: amount } = await Swal.fire({
        title: `Activate ${planName}`,
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                Enter the amount you wish to invest in this Options plan.
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 10px;">
                Minimum Investment: <strong>$${minInvestment.toLocaleString()}</strong>
            </p>
            <p style="color: #8b93a7; font-size: 14px; margin-bottom: 20px;">
                Your Wallet Balance: <strong>$${userWalletBalance.toLocaleString()}</strong>
            </p>
        `,
        input: 'number',
        inputPlaceholder: `Enter amount (min $${minInvestment})`,
        inputAttributes: {
            min: minInvestment,
            step: '0.01'
        },
        showCancelButton: true,
        confirmButtonText: 'Activate Plan',
        cancelButtonText: 'Cancel',
        inputValidator: (value) => {
            if (!value || parseFloat(value) < minInvestment) {
                return `Amount must be at least $${minInvestment}`;
            }
            if (parseFloat(value) > userWalletBalance) {
                return 'Insufficient wallet balance';
            }
        }
    });

    if (!amount) return;

    try {
        TED_AUTH.showLoading('Activating your Options plan...');

        const response = await TED_AUTH.apiCall(`/api/options-plans/activate/${planId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                plan_id: planId,
                amount: parseFloat(amount)
            })
        });

        TED_AUTH.closeLoading();

        const data = await response.json();

        if (!response.ok) {
            TED_AUTH.closeLoading();

            // Check if error is about trader selection
            if (data.detail && data.detail.includes('select at least 1 trader')) {
                Swal.fire({
                    title: 'Error!',
                    html: `Unable to activate plan: ${data.detail}`,
                    icon: 'error'
                });

                // Navigate to traders tab
                document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
                const tradersTab = document.querySelector('.menu-item[data-tab="traders"]');
                if (tradersTab) {
                    tradersTab.classList.add('active');
                    tradersTab.click();
                }
                return;
            }

            throw new Error(data.detail || 'Failed to activate plan');
        }

        // Update wallet balance
        userWalletBalance = data.new_wallet_balance;
        updateWalletDisplay();

        // Show success message
        await Swal.fire({
            title: 'Plan Activated!',
            html: `
                <p style="color: #4caf50; font-weight: 600; margin-bottom: 15px;">
                    Successfully activated ${planName}
                </p>
                <div style="text-align: left; background: rgba(102, 126, 234, 0.08); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <p style="margin: 5px 0;"><strong>Amount Invested:</strong> $${parseFloat(amount).toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>New Wallet Balance:</strong> $${data.new_wallet_balance.toLocaleString()}</p>
                    <p style="margin: 5px 0;"><strong>Maturity Date:</strong> ${new Date(data.maturity_date).toLocaleDateString()}</p>
                </div>
                <p style="color: #8b93a7; font-size: 14px;">
                    <i class="fa fa-info-circle"></i> View your active plan in the Portfolio tab
                </p>
            `,
            icon: 'success',
            confirmButtonText: 'OK'
        });

        // Refresh portfolio to show new investment
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData();
        }

    } catch (error) {
        Swal.fire({
            title: 'Activation Failed',
            text: error.message,
            icon: 'error',
            confirmButtonText: 'OK'
        });
    }
}

/**
 * Show Options plan details
 */
async function showOptionsPlanDetails(planId) {
    Swal.fire({
        title: 'Options Plan Details',
        html: `
            <p style="color: #8b93a7; margin-bottom: 15px;">
                Options copy trading functionality is currently being implemented.
            </p>
            <p style="color: #8b93a7; font-size: 14px;">
                <i class="fa fa-info-circle"></i> Contact support for more information about copying trades from professional options traders.
            </p>
        `,
        icon: 'info',
        confirmButtonText: 'OK'
    });
}

/**
 * Load wallet data (balance and transactions)
 */
let walletDataLoaded = false; // Flag to prevent multiple loads

async function loadWalletData() {
    // Only load once
    if (walletDataLoaded) return;

    try {
        // Fetch wallet balance
        const balanceResponse = await TED_AUTH.apiCall('/api/wallet/balance');
        if (balanceResponse.ok) {
            const balanceData = await balanceResponse.json();
            const balance = balanceData.balance || 0;

            // Update balance displays
            document.getElementById('wallet-balance-display').textContent =
                `$${balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            document.getElementById('withdraw-available-balance').textContent =
                `$${balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Load pending transactions
        await loadPendingTransactions();

        // Load transactions
        await loadTransactions();

        walletDataLoaded = true;
    } catch (error) {
        console.error('Error loading wallet data:', error);
    }
}

/**
 * Load and display pending transactions
 */
async function loadPendingTransactions() {
    try {
        console.log('Loading pending transactions...');
        const response = await TED_AUTH.apiCall('/api/wallet/pending-transactions');

        if (!response.ok) {
            console.error('Failed to fetch pending transactions');
            return;
        }

        const data = await response.json();
        console.log('Pending transactions:', data);

        const indicator = document.getElementById('pending-transactions-indicator');
        const depositsBox = document.getElementById('pending-deposits-box');
        const withdrawalsBox = document.getElementById('pending-withdrawals-box');

        let hasPending = false;

        // Handle pending deposits
        if (data.pending_deposits.count > 0) {
            hasPending = true;
            depositsBox.style.display = 'block';

            const depositText = data.pending_deposits.count === 1
                ? '1 deposit awaiting approval'
                : `${data.pending_deposits.count} deposits awaiting approval`;

            document.getElementById('pending-deposits-text').textContent = depositText;
            document.getElementById('pending-deposits-amount').textContent =
                `+$${data.pending_deposits.total_amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        } else {
            depositsBox.style.display = 'none';
        }

        // Handle pending withdrawals
        if (data.pending_withdrawals.count > 0) {
            hasPending = true;
            withdrawalsBox.style.display = 'block';

            const withdrawalText = data.pending_withdrawals.count === 1
                ? '1 withdrawal awaiting approval'
                : `${data.pending_withdrawals.count} withdrawals awaiting approval`;

            document.getElementById('pending-withdrawals-text').textContent = withdrawalText;
            document.getElementById('pending-withdrawals-amount').textContent =
                `-$${data.pending_withdrawals.total_amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        } else {
            withdrawalsBox.style.display = 'none';
        }

        // Show/hide indicator
        indicator.style.display = hasPending ? 'block' : 'none';

    } catch (error) {
        console.error('Error loading pending transactions:', error);
    }
}

/**
 * Load and display transaction history
 */
async function loadTransactions() {
    console.log('Loading transaction history...');
    const container = document.getElementById('transactions-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading transactions...</p>';

    try {
        const response = await TED_AUTH.apiCall('/api/wallet/transactions');
        console.log('Transactions API response status:', response.status);

        if (!response.ok) {
            throw new Error('Failed to fetch transactions');
        }

        const transactions = await response.json();
        console.log('Fetched transactions:', transactions.length, transactions);

        if (transactions.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No transactions yet. Make your first deposit to get started!</p>';
            return;
        }

        // Create transaction table
        let tableHTML = `
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 2px solid rgba(123, 182, 218, 0.2);">
                            <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Date</th>
                            <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Type</th>
                            <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Details</th>
                            <th style="text-align: right; padding: 12px; color: #8b93a7; font-weight: 600;">Amount</th>
                            <th style="text-align: center; padding: 12px; color: #8b93a7; font-weight: 600;">Status</th>
                            <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Reference</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        transactions.forEach(txn => {
            const date = new Date(txn.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Determine type color, icon, and sign based on transaction type
            let typeColor, typeIcon, amountSign, displayType;

            switch(txn.transaction_type) {
                case 'deposit':
                    typeColor = '#4caf50';
                    typeIcon = 'fa-arrow-down';
                    amountSign = '+';
                    displayType = 'Deposit';
                    break;
                case 'withdrawal':
                    typeColor = '#ff9800';
                    typeIcon = 'fa-arrow-up';
                    amountSign = '-';
                    displayType = 'Withdrawal';
                    break;
                case 'investment':
                    typeColor = '#2196f3';
                    typeIcon = 'fa-chart-line';
                    amountSign = '-';
                    displayType = 'Investment';
                    break;
                default:
                    typeColor = '#8b93a7';
                    typeIcon = 'fa-exchange';
                    amountSign = '';
                    displayType = txn.transaction_type.charAt(0).toUpperCase() + txn.transaction_type.slice(1);
            }

            const statusClass = txn.status === 'completed' ? 'badge-active' :
                               txn.status === 'pending' ? 'badge-pending' : 'badge-inactive';

            // Use description if available, otherwise use payment method
            const details = txn.description || txn.payment_method;

            tableHTML += `
                <tr style="border-bottom: 1px solid rgba(123, 182, 218, 0.1);">
                    <td style="padding: 15px; color: #000;">${date}</td>
                    <td style="padding: 15px;">
                        <span style="color: ${typeColor};">
                            <i class="fa ${typeIcon}"></i> ${displayType}
                        </span>
                    </td>
                    <td style="padding: 15px; color: #8b93a7; max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${details}">${details}</td>
                    <td style="padding: 15px; text-align: right; font-weight: 600; color: ${typeColor};">
                        ${amountSign}$${txn.amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td style="padding: 15px; text-align: center;">
                        <span class="badge-status ${statusClass}">${txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}</span>
                    </td>
                    <td style="padding: 15px; color: #8b93a7; font-family: monospace; font-size: 12px;">${txn.reference_number}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHTML;
    } catch (error) {
        console.error('Error loading transactions:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load transactions. Please try again later.</p>';
    }
}

/**
 * Show deposit modal
 */
function showDepositModal() {
    const modal = document.getElementById('deposit-modal');
    modal.style.display = 'flex';
    document.getElementById('deposit-form').reset();
    // Hide all payment method fields initially
    hideAllDepositPaymentFields();
}

/**
 * Close deposit modal
 */
function closeDepositModal() {
    const modal = document.getElementById('deposit-modal');
    modal.style.display = 'none';
}

/**
 * Show withdraw modal
 */
async function showWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    modal.style.display = 'flex';
    document.getElementById('withdraw-form').reset();

    // Update available balance in modal
    try {
        const response = await TED_AUTH.apiCall('/api/wallet/balance');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('withdraw-available-balance').textContent =
                `$${data.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }
    } catch (error) {
        console.error('Error fetching balance:', error);
    }
}

/**
 * Close withdraw modal
 */
function closeWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    modal.style.display = 'none';

    // Reset views
    document.getElementById('withdraw-form').style.display = 'block';
    document.getElementById('withdraw-verification-view').style.display = 'none';

    // Reset forms
    document.getElementById('withdraw-form').reset();
    if (document.getElementById('withdraw-verification-form')) {
        document.getElementById('withdraw-verification-form').reset();
    }

    // Clear stored request ID
    currentWithdrawalRequestId = null;
}

/**
 * Handle deposit form submission
 */
async function handleDeposit(event) {
    event.preventDefault();

    const amount = parseFloat(document.getElementById('deposit-amount').value);
    const paymentMethod = document.getElementById('deposit-payment-method').value;
    const password = document.getElementById('deposit-password').value;

    if (!amount || !paymentMethod) {
        Swal.fire({ title: 'Warning', text: 'Please fill in all required fields', icon: 'warning' });
        return;
    }

    if (!password) {
        Swal.fire({ title: 'Warning', text: 'Please enter your password to confirm this deposit', icon: 'warning' });
        return;
    }

    if (amount < 10) {
        Swal.fire({ title: 'Warning', text: 'Minimum deposit amount is $10', icon: 'warning' });
        return;
    }

    if (amount > 1000000) {
        Swal.fire({ title: 'Warning', text: 'Maximum deposit amount is $1,000,000', icon: 'warning' });
        return;
    }

    // Collect payment method specific details
    const paymentDetails = {
        amount: amount,
        payment_method: paymentMethod,
        password: password
    };

    // Add method-specific fields
    switch(paymentMethod) {
        case 'Bank Transfer':
            const bankName = document.getElementById('bank-name').value;
            const bankReference = document.getElementById('bank-reference').value;
            if (!bankName || !bankReference) {
                Swal.fire({ title: 'Warning', text: 'Please fill in all bank transfer details', icon: 'warning' });
                return;
            }
            paymentDetails.bank_name = bankName;
            paymentDetails.reference_number = bankReference;
            break;

        case 'Cryptocurrency':
            const cryptoType = document.getElementById('crypto-type').value;
            if (!cryptoType) {
                Swal.fire({ title: 'Warning', text: 'Please select a cryptocurrency', icon: 'warning' });
                return;
            }
            paymentDetails.crypto_type = cryptoType;
            // Get the wallet address that was displayed to the user
            const displayedWalletAddress = document.getElementById('crypto-wallet-address').textContent;
            if (displayedWalletAddress && displayedWalletAddress !== '-') {
                paymentDetails.wallet_address = displayedWalletAddress;
            }
            break;

        case 'Credit Card':
            const cardNumber = document.getElementById('card-number').value;
            const cardExpiry = document.getElementById('card-expiry').value;
            const cardCvv = document.getElementById('card-cvv').value;
            const cardHolderName = document.getElementById('card-holder-name').value;
            if (!cardNumber || !cardExpiry || !cardCvv || !cardHolderName) {
                Swal.fire({ title: 'Warning', text: 'Please fill in all credit card details', icon: 'warning' });
                return;
            }
            paymentDetails.card_number = cardNumber;
            paymentDetails.card_expiry = cardExpiry;
            paymentDetails.card_cvv = cardCvv;
            paymentDetails.card_holder_name = cardHolderName;
            break;
    }

    try {
        TED_AUTH.showLoading('Processing deposit...');

        const response = await TED_AUTH.apiCall('/api/wallet/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentDetails)
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Deposit failed');
        }

        const result = await response.json();

        // Reload pending transactions to show the new pending deposit
        await loadPendingTransactions();

        // Reload transactions list
        await loadTransactions();

        // Close modal
        closeDepositModal();

        // Show success message
        Swal.fire({
            icon: 'success',
            title: 'Deposit Request Submitted',
            html: `
                <p>Your deposit request has been submitted successfully!</p>
                <p><strong>Amount:</strong> $${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <p><strong>Payment Method:</strong> ${paymentMethod}</p>
                <p><strong>Reference:</strong> ${result.transaction.reference_number}</p>
                <p style="color: #ff9800; margin-top: 15px;">
                    <i class="fa fa-info-circle"></i> Your deposit is being processed and will be credited to your account shortly.
                </p>
            `,
            confirmButtonColor: '#D32F2F'
        });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Deposit error:', error);
        Swal.fire({ title: 'Error!', text: `Deposit failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Handle withdraw form submission
 */
// Store withdrawal request ID globally for verification
let currentWithdrawalRequestId = null;

async function handleWithdraw(event) {
    event.preventDefault();

    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const paymentMethod = document.getElementById('withdraw-payment-method').value;
    const password = document.getElementById('withdraw-password').value;

    if (!amount || !paymentMethod || !password) {
        Swal.fire({ title: 'Warning', text: 'Please fill in all required fields', icon: 'warning' });
        return;
    }

    if (amount < 10) {
        Swal.fire({ title: 'Warning', text: 'Minimum withdrawal amount is $10', icon: 'warning' });
        return;
    }

    // Build withdrawal data
    const withdrawalData = {
        amount: amount,
        withdrawal_method: paymentMethod,
        password: password
    };

    // Handle cryptocurrency-specific fields
    if (paymentMethod === 'Cryptocurrency') {
        const cryptoType = document.getElementById('withdraw-crypto-type').value;
        const walletAddress = document.getElementById('withdraw-wallet-address').value;

        if (!cryptoType || !walletAddress) {
            Swal.fire({ title: 'Warning', text: 'Please select cryptocurrency type and enter your wallet address', icon: 'warning' });
            return;
        }

        withdrawalData.crypto_type = cryptoType;
        withdrawalData.wallet_address = walletAddress;
    }

    try {
        TED_AUTH.showLoading('Processing withdrawal request...');

        const response = await TED_AUTH.apiCall('/api/wallet/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(withdrawalData)
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Withdrawal request failed');
        }

        const result = await response.json();

        // Store request ID for verification step
        currentWithdrawalRequestId = result.request_id || result.transaction?.id;

        // Show verification view
        showWithdrawVerificationView(amount, paymentMethod, currentWithdrawalRequestId);

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Withdrawal request error:', error);
        Swal.fire({ title: 'Error!', text: `Withdrawal request failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Show the verification code entry view
 */
function showWithdrawVerificationView(amount, method, requestId) {
    // Hide the main form
    document.getElementById('withdraw-form').style.display = 'none';

    // Show verification view
    const verificationView = document.getElementById('withdraw-verification-view');
    verificationView.style.display = 'block';

    // Populate summary
    document.getElementById('verify-amount-display').textContent =
        `$${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('verify-method-display').textContent = method;
    document.getElementById('verify-request-id-display').textContent = requestId.substring(0, 8) + '...';

    // Clear and focus on code input
    document.getElementById('withdraw-verification-code').value = '';
    document.getElementById('withdraw-verification-code').focus();
}

/**
 * Handle verification code submission
 */
async function handleWithdrawVerification(event) {
    event.preventDefault();

    const verificationCode = document.getElementById('withdraw-verification-code').value.trim();

    if (!verificationCode || verificationCode.length !== 8) {
        Swal.fire({
            title: 'Warning',
            text: 'Please enter a valid 8-character verification code',
            icon: 'warning'
        });
        return;
    }

    if (!currentWithdrawalRequestId) {
        Swal.fire({
            title: 'Error',
            text: 'Request ID not found. Please start over.',
            icon: 'error'
        });
        return;
    }

    try {
        TED_AUTH.showLoading('Verifying code...');

        const response = await TED_AUTH.apiCall('/api/withdrawals/verify-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                request_id: currentWithdrawalRequestId,
                verification_code: verificationCode
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Verification failed');
        }

        const result = await response.json();

        // Reload pending transactions and transactions list
        await loadPendingTransactions();
        await loadTransactions();

        // Close modal
        closeWithdrawModal();

        // Reset for next use
        currentWithdrawalRequestId = null;

        // Navigate to wallet tab
        navigateToWalletTab();

        // Show success message
        Swal.fire({
            icon: 'success',
            title: 'Withdrawal Request Confirmed',
            html: `
                <p>Your withdrawal request has been verified and submitted successfully!</p>
                <p><strong>Amount:</strong> ${document.getElementById('verify-amount-display').textContent}</p>
                <p><strong>Status:</strong> Pending Admin Approval</p>
                <p style="color: #ff9800; margin-top: 15px;">
                    <i class="fa fa-info-circle"></i> Your withdrawal will be processed by our team shortly.
                </p>
            `,
            confirmButtonColor: '#D32F2F'
        });

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Verification error:', error);
        Swal.fire({
            title: 'Verification Failed',
            text: error.message,
            icon: 'error',
            confirmButtonColor: '#D32F2F'
        });
    }
}

/**
 * Cancel verification and go back to form
 */
function cancelWithdrawVerification() {
    // Reset withdrawal request ID
    currentWithdrawalRequestId = null;

    // Hide verification view
    document.getElementById('withdraw-verification-view').style.display = 'none';

    // Show main form
    document.getElementById('withdraw-form').style.display = 'block';
}

/**
 * Check if user should see referral modal (new users)
 */
async function checkAndShowReferralModal(userData) {
    // Check if the user has already submitted a referral, skipped, or seen the modal
    const hasSubmittedReferral = localStorage.getItem('referralSubmitted');
    const hasSkippedReferral = localStorage.getItem('referralModalSkipped');
    const hasSeenReferralModal = localStorage.getItem('hasSeenReferralModal');

    // Only show if user hasn't submitted, skipped, or seen the modal before
    if (!hasSubmittedReferral && !hasSkippedReferral && !hasSeenReferralModal) {
        // Check backend to see if user has already been referred
        try {
            const response = await TED_AUTH.apiCall('/api/referrals/my-statistics');
            if (response.ok) {
                const stats = await response.json();
                // If user was referred by someone, don't show the modal
                if (stats.was_referred) {
                    localStorage.setItem('referralSubmitted', 'true');
                    return;
                }
            }
        } catch (error) {
            console.log('Could not check referral status:', error);
        }

        // Mark as seen immediately to prevent showing again
        localStorage.setItem('hasSeenReferralModal', 'true');

        // Small delay to let dashboard load first
        setTimeout(() => {
            showReferralModal();
        }, 1000);
    }
}

/**
 * Show referral modal for new users
 */
function showReferralModal() {
    const modal = document.getElementById('referral-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close referral modal
 */
function closeReferralModal() {
    const modal = document.getElementById('referral-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Handle referral code submission
 */
async function handleReferralSubmission(event) {
    event.preventDefault();

    const referralCode = document.getElementById('referral-code-input').value.trim();

    if (!referralCode) {
        Swal.fire({ title: 'Warning', text: 'Please enter a referral code', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Verifying referral code...');

        const response = await TED_AUTH.apiCall('/api/referrals/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                referral_code: referralCode
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Invalid referral code');
        }

        const result = await response.json();

        // Mark that referral has been submitted
        localStorage.setItem('referralSubmitted', 'true');

        // Close modal
        closeReferralModal();

        // Show success message
        Swal.fire({ title: 'Success!', text: `Success! Your referrer has been credited with $${result.bonus_amount}. Thank you for using their referral link!`, icon: 'success' });

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Referral submission error:', error);
        Swal.fire({ title: 'Error!', text: `Referral submission failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Skip referral (user doesn't have a code)
 */
function skipReferral(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // Mark as skipped in localStorage
    localStorage.setItem('referralModalSkipped', 'true');

    // Close the modal
    closeReferralModal();

    // Mark in backend (fire and forget)
    TED_AUTH.apiCall('/api/referrals/skip', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    }).catch(function(error) {
        console.error('Error skipping referral:', error);
    });
}

/**
 * Check if Google OAuth user needs to set password and show modal
 */
async function checkAndShowPasswordSetupModal(userData) {
    // Only show for Google OAuth users who registered without password
    // Check if auth_provider is 'google' and the user is new (created recently)
    if (userData.auth_provider === 'google') {
        // Check if user has already set up password using localStorage flag
        const hasSetupPassword = localStorage.getItem('hasSetupOAuthPassword');

        if (!hasSetupPassword) {
            // Small delay to let dashboard load first
            setTimeout(() => {
                showPasswordSetupModal();
            }, 1500);
        }
    }
}

/**
 * Show password setup modal for Google OAuth users
 */
function showPasswordSetupModal() {
    Swal.fire({
        title: 'Set Up Your Password',
        html: `
            <div style="text-align: left; padding: 0 20px;">
                <p style="margin-bottom: 20px; color: #4a5568;">
                    You signed in with Google. Set up a password to enable password-based login as well.
                </p>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #2d3748;">
                        New Password
                    </label>
                    <input
                        type="password"
                        id="oauth-password"
                        class="swal2-input"
                        placeholder="Enter password"
                        style="width: 100%; padding: 12px; margin: 0; border: 1px solid #e2e8f0; border-radius: 6px;"
                    />
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #2d3748;">
                        Confirm Password
                    </label>
                    <input
                        type="password"
                        id="oauth-password-confirm"
                        class="swal2-input"
                        placeholder="Confirm password"
                        style="width: 100%; padding: 12px; margin: 0; border: 1px solid #e2e8f0; border-radius: 6px;"
                    />
                </div>
            </div>
        `,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Set Password',
        cancelButtonText: 'Skip for Now',
        allowOutsideClick: false,
        allowEscapeKey: false,
        customClass: {
            container: 'password-setup-modal',
            popup: 'password-setup-popup'
        },
        preConfirm: () => {
            const password = document.getElementById('oauth-password').value;
            const confirmPassword = document.getElementById('oauth-password-confirm').value;

            if (!password || !confirmPassword) {
                Swal.showValidationMessage('Please fill in both password fields');
                return false;
            }

            if (password.length < 8) {
                Swal.showValidationMessage('Password must be at least 8 characters long');
                return false;
            }

            if (password !== confirmPassword) {
                Swal.showValidationMessage('Passwords do not match');
                return false;
            }

            return { password };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            await handlePasswordSetup(result.value.password);
        } else {
            // User skipped - mark as seen so we don't show again
            localStorage.setItem('hasSetupOAuthPassword', 'skipped');
        }
    });
}

/**
 * Handle password setup for OAuth users
 */
async function handlePasswordSetup(password) {
    try {
        TED_AUTH.showLoading('Setting up your password...');

        const response = await TED_AUTH.apiCall('/api/auth/setup-oauth-password', {
            method: 'POST',
            body: JSON.stringify({ password })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to set password');
        }

        // Mark as completed
        localStorage.setItem('hasSetupOAuthPassword', 'completed');

        // Show success message
        Swal.fire({
            title: 'Success!',
            text: 'Your password has been set up successfully. You can now login with either Google or your password.',
            icon: 'success',
            confirmButtonText: 'OK'
        });

    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Password setup error:', error);
        Swal.fire({
            title: 'Error!',
            text: `Failed to set password: ${error.message}`,
            icon: 'error',
            confirmButtonText: 'OK'
        });
    }
}

/**
 * Load and display referral data
 */
let referralDataLoaded = false;

async function loadReferralData() {
    // Only load once
    if (referralDataLoaded) return;

    try {
        TED_AUTH.showLoading('Loading your referral data...');

        // Get referral link
        const linkResponse = await TED_AUTH.apiCall('/api/referrals/my-link');
        if (linkResponse.ok) {
            const linkData = await linkResponse.json();
            document.getElementById('referral-link').textContent = linkData.referral_link;
        }

        // Get referral statistics
        const statsResponse = await TED_AUTH.apiCall('/api/referrals/my-statistics');
        if (statsResponse.ok) {
            const stats = await statsResponse.json();

            // Update stat boxes
            document.querySelector('#tab-referrals .stat-box:nth-child(1) .stat-value').textContent = stats.total_referrals;
            document.querySelector('#tab-referrals .stat-box:nth-child(2) .stat-value').textContent =
                `$${stats.total_earnings.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            document.querySelector('#tab-referrals .stat-box:nth-child(3) .stat-value').textContent = stats.active_referrals;

            // Display referred users
            displayReferredUsers(stats.referred_users);
        }

        TED_AUTH.closeLoading();
        referralDataLoaded = true;
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Error loading referral data:', error);
        Swal.fire({ title: 'Error!', text: 'Failed to load referral data. Please try again later.', icon: 'error' });
    }
}

/**
 * Display referred users list
 */
function displayReferredUsers(referredUsers) {
    const container = document.querySelector('#tab-referrals .dashboard-card:last-child');

    if (!referredUsers || referredUsers.length === 0) {
        container.innerHTML = `
            <h3 style="margin-bottom: 20px;">Your Referrals</h3>
            <p style="text-align: center; color: #8b93a7; padding: 40px 0;">You haven't referred anyone yet. Start sharing your referral link to earn rewards!</p>
        `;
        return;
    }

    let tableHTML = `
        <h3 style="margin-bottom: 20px;">Your Referrals (${referredUsers.length})</h3>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid rgba(123, 182, 218, 0.2);">
                        <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">User</th>
                        <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Email</th>
                        <th style="text-align: left; padding: 12px; color: #8b93a7; font-weight: 600;">Joined Date</th>
                        <th style="text-align: right; padding: 12px; color: #8b93a7; font-weight: 600;">Bonus Earned</th>
                        <th style="text-align: center; padding: 12px; color: #8b93a7; font-weight: 600;">Status</th>
                    </tr>
                </thead>
                <tbody>
    `;

    referredUsers.forEach(user => {
        const joinedDate = user.joined_date ? new Date(user.joined_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }) : 'N/A';

        const statusClass = user.status === 'completed' ? 'badge-active' : 'badge-pending';

        tableHTML += `
            <tr style="border-bottom: 1px solid rgba(123, 182, 218, 0.1);">
                <td style="padding: 15px; color: #000;">
                    <div style="font-weight: 600;">${user.full_name || user.username}</div>
                    <div style="color: #8b93a7; font-size: 12px;">@${user.username}</div>
                </td>
                <td style="padding: 15px; color: #8b93a7;">${user.email}</td>
                <td style="padding: 15px; color: #000;">${joinedDate}</td>
                <td style="padding: 15px; text-align: right; font-weight: 600; color: #4caf50;">
                    +$${user.bonus_earned.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </td>
                <td style="padding: 15px; text-align: center;">
                    <span class="badge-status ${statusClass}">${user.status.charAt(0).toUpperCase() + user.status.slice(1)}</span>
                </td>
            </tr>
        `;
    });

    tableHTML += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = tableHTML;
}

/**
 * Copy referral link to clipboard
 */
function copyReferralLink() {
    const linkText = document.getElementById('referral-link').textContent;
    navigator.clipboard.writeText(linkText).then(() => {
        Swal.fire({ title: 'Success!', text: 'Referral link copied to clipboard!', icon: 'success' });
    }).catch(err => {
        console.error('Failed to copy:', err);
        Swal.fire({ title: 'Error!', text: 'Failed to copy link. Please try selecting and copying manually.', icon: 'error' });
    });
}

/**
 * Quick Action: Navigate to subscription/robo advisor tab
 */
function quickActionStartRoboAdvisor() {
    // Activate subscription tab
    document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
    const subscriptionTab = document.querySelector('.menu-item[data-tab="subscription"]');
    if (subscriptionTab) {
        subscriptionTab.classList.add('active');
    }

    // Show subscription tab content
    document.querySelectorAll('.tab-content-wrapper').forEach(tc => tc.classList.remove('active'));
    const subscriptionContent = document.getElementById('tab-subscription');
    if (subscriptionContent) {
        subscriptionContent.classList.add('active');
    }

    // Load investment plans
    loadInvestmentPlans();
}

/**
 * Quick Action: Navigate to wallet tab
 */
function quickActionDepositFunds() {
    // Activate wallet tab
    document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
    const walletTab = document.querySelector('.menu-item[data-tab="wallet"]');
    if (walletTab) {
        walletTab.classList.add('active');
    }

    // Show wallet tab content
    document.querySelectorAll('.tab-content-wrapper').forEach(tc => tc.classList.remove('active'));
    const walletContent = document.getElementById('tab-wallet');
    if (walletContent) {
        walletContent.classList.add('active');
    }

    // Load wallet data
    loadWalletData();
}

/**
 * Quick Action: Navigate to traders tab
 */
function quickActionBrowseTraders() {
    // Activate traders tab
    document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
    const tradersTab = document.querySelector('.menu-item[data-tab="traders"]');
    if (tradersTab) {
        tradersTab.classList.add('active');
    }

    // Show traders tab content
    document.querySelectorAll('.tab-content-wrapper').forEach(tc => tc.classList.remove('active'));
    const tradersContent = document.getElementById('tab-traders');
    if (tradersContent) {
        tradersContent.classList.add('active');
    }

    // Load expert traders
    loadExpertTraders();
}

/**
 * Show update profile modal
 */
function showUpdateProfileModal() {
    const modal = document.getElementById('update-profile-modal');
    modal.style.display = 'flex';

    // Pre-fill form with current user data
    const userData = TED_AUTH.getUser();
    if (userData) {
        document.getElementById('update-full-name').value = userData.full_name || '';
        document.getElementById('update-phone').value = userData.phone || '';
        document.getElementById('update-gender').value = userData.gender || '';
        document.getElementById('update-country').value = userData.country || '';
    }
}

/**
 * Close update profile modal
 */
function closeUpdateProfileModal() {
    const modal = document.getElementById('update-profile-modal');
    modal.style.display = 'none';
}

/**
 * Handle update profile form submission
 */
async function handleUpdateProfile(event) {
    event.preventDefault();

    const fullName = document.getElementById('update-full-name').value.trim();
    const phone = document.getElementById('update-phone').value.trim();
    const gender = document.getElementById('update-gender').value;
    const country = document.getElementById('update-country').value.trim();

    try {
        TED_AUTH.showLoading('Updating your profile...');

        const response = await TED_AUTH.apiCall('/api/auth/update-profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                full_name: fullName,
                phone: phone,
                gender: gender,
                country: country
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Profile update failed');
        }

        const result = await response.json();

        // Update user data in localStorage
        TED_AUTH.saveUser(result);

        // Refresh dashboard data
        populateDashboard(result);

        // Close modal
        closeUpdateProfileModal();

        Swal.fire({ title: 'Success!', text: 'Profile updated successfully!', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Profile update error:', error);
        Swal.fire({ title: 'Error!', text: `Profile update failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Show change password modal
 */
function showChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    modal.style.display = 'flex';
    document.getElementById('change-password-form').reset();
}

/**
 * Close change password modal
 */
function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    modal.style.display = 'none';
}

/**
 * Handle change password form submission
 */
async function handleChangePassword(event) {
    event.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;

    // Validate passwords match
    if (newPassword !== confirmNewPassword) {
        Swal.fire({ title: 'Notice', text: 'New passwords do not match!', icon: 'info' });
        return;
    }

    // Validate password strength
    if (newPassword.length < 8) {
        Swal.fire({ title: 'Warning', text: 'Password must be at least 8 characters long', icon: 'warning' });
        return;
    }

    if (!/[A-Z]/.test(newPassword)) {
        Swal.fire({ title: 'Warning', text: 'Password must contain at least one uppercase letter', icon: 'warning' });
        return;
    }

    if (!/[a-z]/.test(newPassword)) {
        Swal.fire({ title: 'Warning', text: 'Password must contain at least one lowercase letter', icon: 'warning' });
        return;
    }

    if (!/[0-9]/.test(newPassword)) {
        Swal.fire({ title: 'Warning', text: 'Password must contain at least one number', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Changing your password...');

        const response = await TED_AUTH.apiCall('/api/auth/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                old_password: currentPassword,
                new_password: newPassword
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Password change failed');
        }

        // Close modal
        closeChangePasswordModal();

        Swal.fire({ title: 'Success!', text: 'Password changed successfully! Please login with your new password.', icon: 'success' });

        // Log out user to force re-login with new password
        setTimeout(() => {
            TED_AUTH.logout();
        }, 1000);
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Password change error:', error);
        Swal.fire({ title: 'Error!', text: `Password change failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Hide all deposit payment method fields
 */
function hideAllDepositPaymentFields() {
    try {
        // Hide bank transfer fields and disable validation
        const bankFields = document.getElementById('bank-transfer-fields');
        if (bankFields) {
            bankFields.style.display = 'none';
            bankFields.querySelectorAll('input, select').forEach(input => {
                input.removeAttribute('required');
            });
        }

        // Hide crypto fields and disable validation
        const cryptoFields = document.getElementById('crypto-fields');
        if (cryptoFields) {
            cryptoFields.style.display = 'none';
            cryptoFields.querySelectorAll('input, select').forEach(input => {
                input.removeAttribute('required');
            });
        }

        // Hide PayPal message
        const paypalFields = document.getElementById('paypal-fields');
        if (paypalFields) {
            paypalFields.style.display = 'none';
        }
    } catch (error) {
        console.error('Error hiding deposit payment fields:', error);
    }
}

/**
 * Load bank account details for deposits
 */
async function loadBankAccountDetails() {
    try {
        const response = await TED_AUTH.apiCall('/api/wallet/deposit-bank-accounts');

        if (response.ok) {
            const bankAccount = await response.json();

            if (bankAccount) {
                // Show bank details content
                document.getElementById('loading-bank-details').style.display = 'none';
                document.getElementById('bank-details-content').style.display = 'block';
                document.getElementById('no-bank-details').style.display = 'none';

                // Populate bank account details
                document.getElementById('deposit-bank-name').textContent = bankAccount.bank_name || 'N/A';
                document.getElementById('deposit-account-number').textContent = bankAccount.account_number || 'N/A';
                document.getElementById('deposit-account-name').textContent = bankAccount.account_name || 'N/A';

                // Show/hide optional fields
                const swiftCodeRow = document.getElementById('swift-code-row');
                const routingNumberRow = document.getElementById('routing-number-row');

                if (bankAccount.swift_code) {
                    document.getElementById('deposit-swift-code').textContent = bankAccount.swift_code;
                    swiftCodeRow.style.display = 'flex';
                } else {
                    swiftCodeRow.style.display = 'none';
                }

                if (bankAccount.routing_number) {
                    document.getElementById('deposit-routing-number').textContent = bankAccount.routing_number;
                    routingNumberRow.style.display = 'flex';
                } else {
                    routingNumberRow.style.display = 'none';
                }
            } else {
                // No bank account available
                document.getElementById('loading-bank-details').style.display = 'none';
                document.getElementById('bank-details-content').style.display = 'none';
                document.getElementById('no-bank-details').style.display = 'block';
            }
        } else {
            console.error('Failed to load bank account details');
            document.getElementById('loading-bank-details').style.display = 'none';
            document.getElementById('no-bank-details').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading bank account details:', error);
        document.getElementById('loading-bank-details').style.display = 'none';
        document.getElementById('no-bank-details').style.display = 'block';
    }
}

/**
 * Toggle deposit payment method fields based on selection
 */
function toggleDepositPaymentFields() {
    try {
        const paymentMethod = document.getElementById('deposit-payment-method').value;
        console.log('Payment method selected:', paymentMethod);

        // Hide all fields first
        hideAllDepositPaymentFields();

        // Show relevant fields based on selected payment method
        switch(paymentMethod) {
            case 'Bank Transfer':
                const bankFields = document.getElementById('bank-transfer-fields');
                if (bankFields) {
                    bankFields.style.display = 'block';
                    console.log('Showing bank transfer fields');

                    // Load bank account details
                    loadBankAccountDetails();
                }
                break;
            case 'Cryptocurrency':
                const cryptoFields = document.getElementById('crypto-fields');
                if (cryptoFields) {
                    cryptoFields.style.display = 'block';
                    console.log('Showing crypto fields');
                } else {
                    console.error('crypto-fields element not found');
                }
                break;
            case 'PayPal':
                const paypalFields = document.getElementById('paypal-fields');
                if (paypalFields) {
                    paypalFields.style.display = 'block';
                    console.log('Showing PayPal unavailability message');
                }
                break;
        }
    } catch (error) {
        console.error('Error toggling deposit payment fields:', error);
    }
}

/**
 * Toggle withdrawal fields based on selection
 */
function toggleWithdrawalFields() {
    try {
        const withdrawalMethod = document.getElementById('withdraw-payment-method').value;
        const cryptoFields = document.getElementById('withdraw-crypto-fields');

        if (cryptoFields) {
            if (withdrawalMethod === 'Cryptocurrency') {
                cryptoFields.style.display = 'block';
                console.log('Showing cryptocurrency withdrawal fields');
            } else {
                cryptoFields.style.display = 'none';
                console.log('Hiding cryptocurrency withdrawal fields');
            }
        }
    } catch (error) {
        console.error('Error toggling withdrawal fields:', error);
    }
}

/**
 * Cryptocurrency wallets cache
 */
let cryptoWallets = {};
let cryptoWalletsData = [];

/**
 * Load crypto wallets from API
 */
async function loadCryptoWallets() {
    try {
        const response = await TED_AUTH.apiCall('/api/crypto-wallets/', {
            method: 'GET'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.wallets) {
                cryptoWalletsData = data.wallets;

                // Get the crypto-type select element
                const cryptoSelect = document.getElementById('crypto-type');

                // Create a map for easy lookup and populate select dropdown
                cryptoWallets = {};

                // Clear existing options except the first placeholder
                if (cryptoSelect) {
                    cryptoSelect.innerHTML = '<option value="">Select cryptocurrency</option>';
                }

                data.wallets.forEach(wallet => {
                    // Use the cryptocurrency name from the wallet
                    const displayName = wallet.currency;
                    const network = wallet.network || '';

                    // Create display text with network if available
                    const optionText = network
                        ? `${displayName} (${network})`
                        : displayName;

                    // Add option to select dropdown
                    if (cryptoSelect) {
                        const option = document.createElement('option');
                        option.value = displayName;
                        option.textContent = optionText;
                        cryptoSelect.appendChild(option);
                    }

                    // Store wallet data for lookup
                    cryptoWallets[displayName] = {
                        address: wallet.wallet_address,
                        network: wallet.network,
                        qr_code_url: wallet.qr_code_url,
                        id: wallet.id
                    };
                });
            }
        }
    } catch (error) {
        console.error('Error loading crypto wallets:', error);
    }
}

/**
 * Handle crypto type change to display wallet info and QR code
 */
async function handleCryptoTypeChange() {
    const selectedCrypto = document.getElementById('crypto-type').value;
    const walletInfo = document.getElementById('crypto-wallet-info');
    const walletAddress = document.getElementById('crypto-wallet-address');
    const qrCodeImg = document.getElementById('crypto-qr-code');

    if (selectedCrypto && cryptoWallets[selectedCrypto]) {
        const wallet = cryptoWallets[selectedCrypto];

        // Display wallet address
        walletAddress.textContent = wallet.address;

        // Display QR code
        try {
            const response = await TED_AUTH.apiCall(`/api/crypto-wallets/${wallet.id}/qr/base64`, {
                method: 'GET'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.qr_code) {
                    qrCodeImg.src = data.qr_code;
                    qrCodeImg.style.display = 'block';
                } else {
                    qrCodeImg.style.display = 'none';
                }
            } else {
                qrCodeImg.style.display = 'none';
            }
        } catch (error) {
            console.error('Error loading QR code:', error);
            qrCodeImg.style.display = 'none';
        }

        walletInfo.style.display = 'block';
    } else {
        walletInfo.style.display = 'none';
        qrCodeImg.style.display = 'none';
    }
}

/**
 * Handle crypto type selection to show wallet address with QR code
 */
document.addEventListener('DOMContentLoaded', function() {
    // Load crypto wallets on page load
    loadCryptoWallets();
});

/**
 * Display QR code for wallet
 */
async function displayWalletQRCode(walletId) {
    try {
        // Check if QR code container exists, if not create it
        let qrContainer = document.getElementById('crypto-qr-container');
        if (!qrContainer) {
            const walletInfo = document.getElementById('crypto-wallet-info');
            qrContainer = document.createElement('div');
            qrContainer.id = 'crypto-qr-container';
            qrContainer.style.cssText = 'margin-top: 15px; text-align: center;';

            // Insert after the copy button
            const copyButton = walletInfo.querySelector('button');
            copyButton.parentNode.insertBefore(qrContainer, copyButton.nextSibling);
        }

        // Show loading
        qrContainer.innerHTML = '<p style="color: #8b93a7; font-size: 12px;">Loading QR code...</p>';

        // Fetch QR code as base64
        const response = await TED_AUTH.apiCall(`/api/crypto-wallets/${walletId}/qr/base64`, {
            method: 'GET'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.qr_code) {
                qrContainer.innerHTML = `
                    <p style="color: #8b93a7; font-size: 12px; margin-bottom: 8px;">Scan QR Code to Pay:</p>
                    <img src="${data.qr_code}"
                         alt="Wallet QR Code"
                         style="max-width: 200px; border: 2px solid #e0e0e0; border-radius: 8px; padding: 10px; background: white;">
                    <p style="color: #8b93a7; font-size: 11px; margin-top: 8px;">
                        ${data.network ? `Network: ${data.network}` : ''}
                    </p>
                `;
            }
        } else {
            qrContainer.innerHTML = '<p style="color: #ff6b6b; font-size: 12px;">Failed to load QR code</p>';
        }
    } catch (error) {
        console.error('Error displaying QR code:', error);
        const qrContainer = document.getElementById('crypto-qr-container');
        if (qrContainer) {
            qrContainer.innerHTML = '<p style="color: #ff6b6b; font-size: 12px;">Error loading QR code</p>';
        }
    }
}

/**
 * Copy crypto wallet address to clipboard
 */
function copyCryptoAddress() {
    const address = document.getElementById('crypto-wallet-address').textContent;
    if (address && address !== '-') {
        navigator.clipboard.writeText(address).then(() => {
            Swal.fire({ title: 'Success!', text: 'Wallet address copied to clipboard!', icon: 'success' });
        }).catch(err => {
            console.error('Failed to copy:', err);
            Swal.fire({ title: 'Error!', text: 'Failed to copy address. Please try selecting and copying manually.', icon: 'error' });
        });
    }
}

/**
 * Load and display portfolio performance
 */
let portfolioLoaded = false;

async function loadPortfolioPerformance(forceReload = false) {
    // Skip if already loaded and not forcing reload
    if (portfolioLoaded && !forceReload) {
        return;
    }

    const container = document.getElementById('investments-container');
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading your investments...</p>';

    try {
        const response = await TED_AUTH.apiCall('/api/investments/portfolio', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch portfolio: ${response.statusText}`);
        }

        const portfolio = await response.json();

        // Update summary stats
        document.getElementById('portfolio-total-invested').textContent =
            `$${portfolio.total_invested.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        document.getElementById('portfolio-current-value').textContent =
            `$${portfolio.current_value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        const profitLossElement = document.getElementById('portfolio-profit-loss');
        const profitLossColor = portfolio.total_profit_loss >= 0 ? '#4caf50' : '#f44336';
        const profitLossSign = portfolio.total_profit_loss >= 0 ? '+' : '';
        profitLossElement.textContent = `${profitLossSign}$${portfolio.total_profit_loss.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${profitLossSign}${portfolio.total_profit_loss_percent.toFixed(2)}%)`;
        profitLossElement.style.color = profitLossColor;

        document.getElementById('portfolio-active-investments').textContent = portfolio.active_investments;

        // Display investments
        if (portfolio.investments.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No investments yet. Start investing to see your portfolio here!</p>';
        } else {
            displayInvestments(portfolio.investments);
        }

        portfolioLoaded = true;
    } catch (error) {
        console.error('Error loading portfolio:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load portfolio. Please try again later.</p>';
    }
}

/**
 * Display investments in the container
 */
function displayInvestments(investments) {
    const container = document.getElementById('investments-container');
    container.innerHTML = '';

    investments.forEach(investment => {
        const card = createInvestmentCard(investment);
        container.appendChild(card);
    });
}

/**
 * Create an investment card element
 */
function createInvestmentCard(investment) {
    const card = document.createElement('div');
    card.className = 'plan-card';

    const profitColor = investment.profit_loss >= 0 ? '#4caf50' : '#f44336';
    const profitSign = investment.profit_loss >= 0 ? '+' : '';

    const statusClass = investment.status === 'active' ? 'badge-active' :
                        investment.status === 'matured' ? 'badge-pending' : 'badge-inactive';
    const statusText = investment.status.charAt(0).toUpperCase() + investment.status.slice(1);

    const startDate = new Date(investment.start_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const maturityDate = new Date(investment.maturity_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    // Calculate progress percentage
    const totalDays = investment.days_elapsed + investment.days_remaining;
    const progressPercent = totalDays > 0 ? (investment.days_elapsed / totalDays * 100) : 0;

    // Traders are now separate from investment plans
    let tradersHTML = '';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="color: #D32F2F; margin: 0;">${investment.plan_name}</h3>
            <span class="badge-status ${statusClass}">${statusText}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div>
                <div style="font-size: 24px; font-weight: bold; color: #000;">$${investment.amount_invested.toLocaleString()}</div>
                <div style="font-size: 12px; color: #8b93a7;">Amount Invested</div>
            </div>
            <div>
                <div style="font-size: 24px; font-weight: bold; color: ${profitColor};">${profitSign}$${Math.abs(investment.profit_loss).toLocaleString()}</div>
                <div style="font-size: 12px; color: #8b93a7;">Profit/Loss (${profitSign}${investment.profit_loss_percent.toFixed(2)}%)</div>
            </div>
        </div>

        <div style="background: rgba(123, 182, 218, 0.05); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #8b93a7; font-size: 14px;">Current Value:</span>
                <span style="color: #000; font-weight: 600;">$${investment.current_value.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #8b93a7; font-size: 14px;">Expected Return:</span>
                <span style="color: #4caf50; font-weight: 600;">${investment.expected_return_percent}%</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #8b93a7; font-size: 14px;">Holding Period:</span>
                <span style="color: #000; font-weight: 600;">${investment.holding_period_months} months</span>
            </div>
        </div>

        <div style="margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span style="color: #8b93a7; font-size: 12px;">Investment Progress</span>
                <span style="color: #000; font-size: 12px; font-weight: 600;">${progressPercent.toFixed(0)}%</span>
            </div>
            <div style="width: 100%; height: 8px; background: rgba(123, 182, 218, 0.2); border-radius: 4px; overflow: hidden;">
                <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #D32F2F, #5a9abf); border-radius: 4px;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${investment.days_elapsed} days elapsed</span>
                <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${investment.days_remaining} days remaining</span>
            </div>
        </div>

        <div style="background: rgba(123, 182, 218, 0.05); border-radius: 8px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #8b93a7; font-size: 13px;">Start Date:</span>
                <span style="color: #000; font-weight: 600; font-size: 13px;">${startDate}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span style="color: #8b93a7; font-size: 13px;">Maturity Date:</span>
                <span style="color: #000; font-weight: 600; font-size: 13px;">${maturityDate}</span>
            </div>
        </div>

        ${tradersHTML}
    `;

    return card;
}

// Tab-specific data loading is handled by loadTabData() in dashboard.html

/**
 * Load and display active investments on the dashboard home tab
 */
async function loadDashboardActiveInvestments() {
    try {
        const response = await TED_AUTH.apiCall('/api/investments/portfolio', {
            method: 'GET'
        });

        if (!response.ok) {
            console.error('Failed to fetch portfolio for dashboard');
            return;
        }

        const portfolio = await response.json();

        // Only show active investments section if user has active investments
        if (portfolio.active_investments > 0 && portfolio.investments.length > 0) {
            const activeInvestmentsCard = document.getElementById('active-investments-card');
            const container = document.getElementById('dashboard-active-investments-container');

            if (activeInvestmentsCard && container) {
                activeInvestmentsCard.style.display = 'block';

                // Filter only active investments
                const activeInvestments = portfolio.investments.filter(inv => inv.status === 'active');

                // Display up to 3 active investments on dashboard
                const displayInvestments = activeInvestments.slice(0, 3);

                container.innerHTML = '';
                displayInvestments.forEach(investment => {
                    const card = createDashboardInvestmentCard(investment);
                    container.appendChild(card);
                });

                // Show message if there are more investments
                if (activeInvestments.length > 3) {
                    const moreMessage = document.createElement('div');
                    moreMessage.style.cssText = 'text-align: center; padding: 15px; color: #8b93a7; font-size: 14px;';
                    moreMessage.innerHTML = `<i class="fa fa-info-circle"></i> And ${activeInvestments.length - 3} more active investment${activeInvestments.length - 3 > 1 ? 's' : ''}. <a href="#" onclick="viewFullPortfolio(); return false;" style="color: #D32F2F; text-decoration: underline;">View all</a>`;
                    container.appendChild(moreMessage);
                }
            }
        }
    } catch (error) {
        console.error('Error loading dashboard active investments:', error);
    }
}

/**
 * Create a compact investment card for dashboard display
 */
function createDashboardInvestmentCard(investment) {
    const card = document.createElement('div');
    card.className = 'plan-card';
    card.style.marginBottom = '15px';

    const profitColor = investment.profit_loss >= 0 ? '#4caf50' : '#f44336';
    const profitSign = investment.profit_loss >= 0 ? '+' : '';

    const maturityDate = new Date(investment.maturity_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    // Calculate progress percentage
    const totalDays = investment.days_elapsed + investment.days_remaining;
    const progressPercent = totalDays > 0 ? (investment.days_elapsed / totalDays * 100) : 0;

    // Traders are now separate from investment plans
    let tradersHTML = '';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div>
                <h3 style="color: #D32F2F; margin: 0 0 5px 0; font-size: 18px;">${investment.plan_name}</h3>
                <span class="badge-status badge-active" style="font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Active</span>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 20px; font-weight: bold; color: #000;">$${investment.amount_invested.toLocaleString()}</div>
                <div style="font-size: 11px; color: #8b93a7;">Invested</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; padding: 12px; background: rgba(123, 182, 218, 0.05); border-radius: 8px;">
            <div>
                <div style="font-size: 16px; font-weight: bold; color: ${profitColor};">${profitSign}$${Math.abs(investment.profit_loss).toLocaleString()}</div>
                <div style="font-size: 11px; color: #8b93a7;">Profit/Loss</div>
            </div>
            <div>
                <div style="font-size: 16px; font-weight: bold; color: #000;">$${investment.current_value.toLocaleString()}</div>
                <div style="font-size: 11px; color: #8b93a7;">Current Value</div>
            </div>
            <div>
                <div style="font-size: 16px; font-weight: bold; color: #4caf50;">${investment.expected_return_percent}%</div>
                <div style="font-size: 11px; color: #8b93a7;">Expected Return</div>
            </div>
        </div>

        <div style="margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span style="color: #8b93a7; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">Progress to Maturity</span>
                <span style="color: #000; font-size: 11px; font-weight: 600;">${progressPercent.toFixed(0)}%</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(123, 182, 218, 0.2); border-radius: 3px; overflow: hidden;">
                <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #D32F2F, #5a9abf); border-radius: 3px;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                <span style="color: #8b93a7; font-size: 10px;">${investment.days_remaining} days remaining</span>
                <span style="color: #8b93a7; font-size: 10px;">Matures: ${maturityDate}</span>
            </div>
        </div>

        ${tradersHTML}
    `;

    return card;
}

/**
 * Navigate to full portfolio view
 */
function viewFullPortfolio() {
    // Activate portfolio tab
    document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
    document.querySelectorAll('.submenu-item').forEach(si => si.classList.remove('active'));
    
    // Find and activate the automated-calls submenu item
    const automatedCallsTab = document.querySelector('.submenu-item[data-tab="automated-calls"]');
    if (automatedCallsTab) {
        automatedCallsTab.classList.add('active');
    }

    // Show portfolio tab content
    document.querySelectorAll('.tab-content-wrapper').forEach(tc => tc.classList.remove('active'));
    const portfolioContent = document.getElementById('tab-automated-calls');
    if (portfolioContent) {
        portfolioContent.classList.add('active');
    }

    // Load portfolio data
    loadPortfolioPerformance(true);
}

let activeCopiesCache = null;

async function loadActiveCopies(forceReload = false) {
    console.log('[loadActiveCopies] Called, forceReload:', forceReload);
    
    if (activeCopiesCache && !forceReload) {
        console.log('[loadActiveCopies] Using cache');
        renderActiveCopies(activeCopiesCache);
        return;
    }
    
    const container = document.getElementById('active-copies-container');
    if (!container) {
        console.error('[loadActiveCopies] Container not found!');
        return;
    }
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading active copies...</p>';
    
    try {
        // Get user data to check copy_trading_allocation
        const userResponse = await TED_AUTH.apiCall('/api/auth/me', { method: 'GET' });
        let copyTradingAllocation = 0;
        let walletBalance = 0;
        if (userResponse.ok) {
            const userData = await userResponse.json();
            copyTradingAllocation = userData.copy_trading_allocation || 0;
            walletBalance = userData.wallet_balance || 0;
            // If no specific allocation, use wallet balance
            if (copyTradingAllocation === 0) {
                copyTradingAllocation = walletBalance;
            }
            console.log('[loadActiveCopies] Copy trading allocation:', copyTradingAllocation, 'Wallet balance:', walletBalance);
        }
        
        // Get selected traders from the user
        const response = await TED_AUTH.apiCall('/api/traders/selected/list', { method: 'GET' });
        
        if (!response.ok) {
            throw new Error('Failed to fetch active copies: ' + response.status);
        }
        
        const data = await response.json();
        console.log('[loadActiveCopies] Selected traders data:', data);
        
        const selectedTraders = data.selected_traders || [];
        
        // Calculate amount per trader (evenly split)
        const amountPerTrader = selectedTraders.length > 0 ? copyTradingAllocation / selectedTraders.length : 0;
        
        // Transform selected traders into active copies format
        console.log('[loadActiveCopies] Selected traders:', selectedTraders);
        const activeCopies = selectedTraders.map(trader => {
            const amount = amountPerTrader;
            const ytdReturn = trader.ytd_return || 0;
            // Calculate current value based on YTD return
            const currentValue = amount > 0 ? amount * (1 + ytdReturn / 100) : 0;
            
            return {
                trader_id: trader.id || trader._id,
                trader_name: trader.full_name || 'Unknown Trader',
                trader_photo: trader.profile_photo || '',
                specialization: trader.specialization || 'General',
                amount: amount,
                current_value: currentValue,
                ytd_return: ytdReturn,
                win_rate: trader.win_rate || 0
            };
        });
        
        console.log('[loadActiveCopies] Transformed copies:', activeCopies);
        
        activeCopiesCache = activeCopies;
        renderActiveCopies(activeCopies);
        
    } catch (error) {
        console.error('[loadActiveCopies] Error:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load active copies: ' + error.message + '</p>';
    }
}

function renderActiveCopies(investments) {
    const container = document.getElementById('active-copies-container');
    const countEl = document.getElementById('active-copies-count');
    const totalEl = document.getElementById('active-copies-total');
    const pnlEl = document.getElementById('active-copies-pnl');
    const roiEl = document.getElementById('active-copies-roi');
    
    if (!container) return;
    
    if (!investments || investments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">You are not currently copying any traders.</p>';
        if (countEl) countEl.textContent = '0';
        if (totalEl) totalEl.textContent = '$0.00';
        if (pnlEl) pnlEl.textContent = '$0.00';
        if (roiEl) roiEl.textContent = '0%';
        return;
    }
    
    let totalCopied = 0;
    let totalPnL = 0;
    
    const copiesHTML = investments.map(inv => {
        const currentValue = inv.current_value || inv.amount || 0;
        const amount = inv.amount || 0;
        const pnl = currentValue - amount;
        const roi = amount > 0 ? ((currentValue - amount) / amount) * 100 : 0;
        
        totalCopied += amount;
        totalPnL += pnl;
        
        const pnlClass = pnl >= 0 ? 'positive' : 'negative';
        const avatarHtml = (inv.trader_photo && inv.trader_photo.trim())
            ? `<img src="${inv.trader_photo}" class="copy-avatar" onerror="this.outerHTML='<div class=\\'copy-avatar\\'><i class=\\'fa-solid fa-user\\'></i></div>'" />`
            : `<div class="copy-avatar"><i class="fa-solid fa-user"></i></div>`;
        
        return `
            <div class="copy-card">
                <div class="copy-header">
                    <div class="copy-trader">
                        ${avatarHtml}
                        <div class="copy-trader-info">
                            <span class="copy-trader-name">${inv.trader_name || 'Unknown Trader'}</span>
                            <span class="copy-trader-specialization">${inv.specialization || 'General'}</span>
                        </div>
                    </div>
                    <span class="copy-status active">Active</span>
                </div>
                <div class="copy-stats">
                    <div class="copy-stat">
                        <span class="label">Invested</span>
                        <span class="value">$${amount.toLocaleString()}</span>
                    </div>
                    <div class="copy-stat">
                        <span class="label">Current Value</span>
                        <span class="value">$${currentValue.toLocaleString()}</span>
                    </div>
                    <div class="copy-stat">
                        <span class="label">P&L</span>
                        <span class="value ${pnlClass}">${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString()}</span>
                    </div>
                    <div class="copy-stat">
                        <span class="label">ROI</span>
                        <span class="value ${pnlClass}">${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `<div class="copies-grid">${copiesHTML}</div>`;
    
    const avgROI = totalCopied > 0 ? (totalPnL / totalCopied) * 100 : 0;
    
    if (countEl) countEl.textContent = investments.length;
    if (totalEl) totalEl.textContent = '$' + totalCopied.toLocaleString();
    if (pnlEl) pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toLocaleString();
    if (roiEl) roiEl.textContent = (avgROI >= 0 ? '+' : '') + avgROI.toFixed(2) + '%';
}

let performanceCache = null;

async function loadPerformance(forceReload = false) {
    console.log('[loadPerformance] Called, forceReload:', forceReload);
    
    if (performanceCache && !forceReload) {
        console.log('[loadPerformance] Using cache');
        renderPerformance(performanceCache);
        return;
    }
    
    const container = document.getElementById('performance-container');
    if (!container) {
        console.error('[loadPerformance] Container not found!');
        return;
    }
    container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading performance data...</p>';
    
    try {
        // Get selected traders from the user
        const response = await TED_AUTH.apiCall('/api/traders/selected/list', { method: 'GET' });
        
        if (!response.ok) {
            throw new Error('Failed to fetch performance: ' + response.status);
        }
        
        const data = await response.json();
        console.log('[loadPerformance] Selected traders data:', data);
        
        const selectedTraders = data.selected_traders || [];
        
        // Transform selected traders into performance format
        const performanceData = {
            total_invested: 0,
            current_value: 0,
            total_trades: selectedTraders.reduce((sum, t) => sum + (t.trades?.length || 0), 0),
            win_rate: 0,
            investments: selectedTraders.map(trader => ({
                trader_id: trader.id || trader._id,
                trader_name: trader.full_name || 'Unknown Trader',
                trader_photo: trader.profile_photo || '',
                specialization: trader.specialization || 'General',
                amount: 0,
                current_value: 0,
                ytd_return: trader.ytd_return || 0,
                win_rate: trader.win_rate || 0
            }))
        };
        
        // Calculate average win rate
        if (selectedTraders.length > 0) {
            const totalWinRate = selectedTraders.reduce((sum, t) => sum + (t.win_rate || 0), 0);
            performanceData.win_rate = totalWinRate / selectedTraders.length;
        }
        
        console.log('[loadPerformance] Performance data:', performanceData);
        
        performanceCache = performanceData;
        renderPerformance(performanceData);
        
    } catch (error) {
        console.error('[loadPerformance] Error:', error);
        container.innerHTML = '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load performance: ' + error.message + '</p>';
    }
}

function renderPerformance(portfolio) {
    const container = document.getElementById('performance-container');
    const comparisonContainer = document.getElementById('performance-comparison-container');
    const returnEl = document.getElementById('perf-total-return');
    const returnRateEl = document.getElementById('perf-return-rate');
    const winRateEl = document.getElementById('perf-win-rate');
    const tradesEl = document.getElementById('perf-total-trades');
    
    if (!container) return;
    
    const totalInvested = portfolio.total_invested || 0;
    const currentValue = portfolio.current_value || 0;
    const totalReturn = currentValue - totalInvested;
    const returnRate = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;
    const totalTrades = portfolio.total_trades || 0;
    const winRate = portfolio.win_rate || 0;
    const investments = portfolio.investments || [];
    
    // Performance breakdown
    let profitableCount = 0;
    let losingCount = 0;
    investments.forEach(inv => {
        const currentVal = inv.current_value || inv.amount || 0;
        const amount = inv.amount || 0;
        if (currentVal > amount) profitableCount++;
        else if (currentVal < amount) losingCount++;
    });
    
    container.innerHTML = `
        <div class="performance-stats-grid">
            <div class="performance-stat-card">
                <span class="label">Total Invested</span>
                <span class="value">$${totalInvested.toLocaleString()}</span>
            </div>
            <div class="performance-stat-card">
                <span class="label">Current Value</span>
                <span class="value">$${currentValue.toLocaleString()}</span>
            </div>
            <div class="performance-stat-card">
                <span class="label">Total Return</span>
                <span class="value ${totalReturn >= 0 ? 'positive' : 'negative'}">${totalReturn >= 0 ? '+' : ''}$${totalReturn.toLocaleString()}</span>
            </div>
            <div class="performance-stat-card">
                <span class="label">Return Rate</span>
                <span class="value ${returnRate >= 0 ? 'positive' : 'negative'}">${returnRate >= 0 ? '+' : ''}${returnRate.toFixed(2)}%</span>
            </div>
            <div class="performance-stat-card">
                <span class="label">Winning Trades</span>
                <span class="value positive">${profitableCount}</span>
            </div>
            <div class="performance-stat-card">
                <span class="label">Losing Trades</span>
                <span class="value negative">${losingCount}</span>
            </div>
        </div>
    `;
    
    if (returnEl) returnEl.textContent = (totalReturn >= 0 ? '+' : '') + '$' + totalReturn.toLocaleString();
    if (returnRateEl) returnRateEl.textContent = (returnRate >= 0 ? '+' : '') + returnRate.toFixed(2) + '%';
    if (winRateEl) winRateEl.textContent = winRate.toFixed(2) + '%';
    if (tradesEl) tradesEl.textContent = totalTrades;
    
    // Comparison with active copies
    if (comparisonContainer) {
        if (investments.length === 0) {
            comparisonContainer.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No active copies to compare.</p>';
        } else {
            let userTotalReturn = totalReturn;
            let copyComparisonHTML = investments.map(inv => {
                const currentVal = inv.current_value || inv.amount || 0;
                const amount = inv.amount || 0;
                const copyPnL = currentVal - amount;
                const copyROI = amount > 0 ? ((currentVal - amount) / amount) * 100 : 0;
                
                return `
                    <div class="comparison-row">
                        <span class="trader-name">${inv.trader_name || 'Unknown'}</span>
                        <span class="trader-roi ${copyROI >= 0 ? 'positive' : 'negative'}">${copyROI >= 0 ? '+' : ''}${copyROI.toFixed(2)}%</span>
                        <span class="trader-pnl ${copyPnL >= 0 ? 'positive' : 'negative'}">${copyPnL >= 0 ? '+' : ''}$${copyPnL.toLocaleString()}</span>
                    </div>
                `;
            }).join('');
            
            comparisonContainer.innerHTML = `
                <div class="comparison-header">
                    <span>Trader</span>
                    <span>ROI</span>
                    <span>P&L</span>
                </div>
                ${copyComparisonHTML}
                <div class="comparison-total">
                    <span>Your Total</span>
                    <span class="${userTotalReturn >= 0 ? 'positive' : 'negative'}">${userTotalReturn >= 0 ? '+' : ''}$${userTotalReturn.toLocaleString()}</span>
                </div>
            `;
        }
    }
}

/**
 * Load and display dashboard statistics (portfolio value, active copies, total return)
 */
async function loadDashboardStats() {
    try {
        // Fetch user data to get wallet balance
        const userResponse = await TED_AUTH.apiCall('/api/auth/me', {
            method: 'GET'
        });

        if (userResponse.ok) {
            const userData = await userResponse.json();
            userWalletBalance = userData.wallet_balance !== undefined ? userData.wallet_balance : 0;
        }

        // Fetch portfolio data from API (same data as portfolio tab)
        const response = await TED_AUTH.apiCall('/api/investments/portfolio', {
            method: 'GET'
        });

        if (!response.ok) {
            console.error('Failed to fetch portfolio for dashboard stats');
            return;
        }

        const portfolio = await response.json();

        // Update Portfolio Value stat box - use current_value from portfolio
        const portfolioValueElement = document.getElementById('dashboard-portfolio-value');
        if (portfolioValueElement) {
            portfolioValueElement.textContent = `$${portfolio.current_value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Update Active Copies stat box - fetch selected traders count
        const activeCopiesElement = document.getElementById('dashboard-active-copies');
        if (activeCopiesElement) {
            // Fetch the count of traders being copied
            try {
                const tradersResponse = await TED_AUTH.apiCall('/api/traders/selected/list', {
                    method: 'GET'
                });

                if (tradersResponse.ok) {
                    const tradersData = await tradersResponse.json();
                    activeCopiesElement.textContent = tradersData.count || 0;
                } else {
                    activeCopiesElement.textContent = 0;
                }
            } catch (error) {
                console.error('Error fetching selected traders count:', error);
                activeCopiesElement.textContent = 0;
            }
        }

        // Update Total Return stat box - use total_profit_loss_percent with color
        const totalReturnElement = document.getElementById('dashboard-total-return');
        if (totalReturnElement) {
            const profitLossPercent = portfolio.total_profit_loss_percent || 0;
            const profitLossColor = profitLossPercent >= 0 ? '#4caf50' : '#f44336';
            const profitLossSign = profitLossPercent >= 0 ? '+' : '';

            totalReturnElement.textContent = `${profitLossSign}${profitLossPercent.toFixed(2)}%`;
            totalReturnElement.style.color = profitLossColor;
        }

        // Update Wallet Balance on home dashboard
        const dashboardWalletElement = document.getElementById('dashboard-wallet-balance');
        if (dashboardWalletElement) {
            dashboardWalletElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        console.log('Dashboard stats updated:', {
            portfolio_value: portfolio.current_value,
            active_investments: portfolio.active_investments,
            total_return: portfolio.total_profit_loss_percent,
            wallet_balance: userWalletBalance
        });

    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

/**
 * Update wallet balance display across all locations
 */
function updateWalletDisplay() {
    // Update wallet balance in header
    const walletBalanceDisplayElement = document.getElementById('wallet-balance-display');
    if (walletBalanceDisplayElement) {
        walletBalanceDisplayElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    const walletBalanceElement = document.getElementById('wallet-balance');
    if (walletBalanceElement) {
        walletBalanceElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    // Update wallet balance on home dashboard
    const dashboardWalletElement = document.getElementById('dashboard-wallet-balance');
    if (dashboardWalletElement) {
        dashboardWalletElement.textContent = `$${userWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
}

/**
 * Navigate to the wallet tab
 */
function navigateToWalletTab() {
    // Find the wallet menu item and simulate a click
    const walletMenuItem = document.querySelector('.menu-item[data-tab="wallet"]');
    if (walletMenuItem) {
        walletMenuItem.click();
    }
}

// Export functions for use in HTML
window.handleLogout = handleLogout;
window.copyTrader = copyTrader;
window.investInPlan = investInPlan;
window.loadInvestmentPlans = loadInvestmentPlans;
window.viewFullPortfolio = viewFullPortfolio;
window.showDepositModal = showDepositModal;
window.closeDepositModal = closeDepositModal;
window.showWithdrawModal = showWithdrawModal;
window.closeWithdrawModal = closeWithdrawModal;
/**
 * Update password button UI based on user's password status
 */
function updatePasswordButtonUI(userData) {
    const passwordActionBtn = document.getElementById('password-action-btn');
    const passwordActionText = document.getElementById('password-action-text');
    const passwordDescription = document.getElementById('password-management-description');

    if (!passwordActionBtn || !passwordActionText) return;

    // Check if user has a password set
    if (userData.has_password === false) {
        // User doesn't have a password - show "Create Password"
        passwordActionText.textContent = 'Create Password';
        passwordActionText.setAttribute('data-i18n', 'settings.security.createPassword');

        if (passwordDescription) {
            passwordDescription.textContent = 'Create a password to enable password-based login alongside Google Sign-In.';
            passwordDescription.setAttribute('data-i18n', 'security.createPasswordDesc');
        }
    } else {
        // User has a password - show "Change Password"
        passwordActionText.textContent = 'Change Password';
        passwordActionText.setAttribute('data-i18n', 'settings.security.changePassword');

        if (passwordDescription) {
            passwordDescription.textContent = 'Change your password to keep your account secure.';
            passwordDescription.setAttribute('data-i18n', 'security.changePasswordDesc');
        }
    }
}

/**
 * Handle password action - either create or change password based on user status
 */
function handlePasswordAction() {
    const userData = TED_AUTH.getUser();

    if (!userData) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Please refresh the page and try again.',
            confirmButtonColor: '#D32F2F'
        });
        return;
    }

    // Check if user has a password
    if (userData.has_password === false) {
        // Open password creation modal
        openPasswordCreationModal();
    } else {
        // Open password change modal
        openPasswordChangeModal();
    }
}

window.handleDeposit = handleDeposit;
window.handleWithdraw = handleWithdraw;
window.handleWithdrawVerification = handleWithdrawVerification;
window.cancelWithdrawVerification = cancelWithdrawVerification;
window.copyReferralLink = copyReferralLink;
window.handleReferralSubmission = handleReferralSubmission;
window.closeReferralModal = closeReferralModal;
window.skipReferral = skipReferral;
window.showUpdateProfileModal = showUpdateProfileModal;
window.closeUpdateProfileModal = closeUpdateProfileModal;
window.handleUpdateProfile = handleUpdateProfile;
window.showChangePasswordModal = showChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.handleChangePassword = handleChangePassword;
window.quickActionStartRoboAdvisor = quickActionStartRoboAdvisor;
window.quickActionDepositFunds = quickActionDepositFunds;
window.quickActionBrowseTraders = quickActionBrowseTraders;
window.toggleDepositPaymentFields = toggleDepositPaymentFields;
window.toggleWithdrawalFields = toggleWithdrawalFields;
window.copyCryptoAddress = copyCryptoAddress;
window.handleCryptoTypeChange = handleCryptoTypeChange;
window.updateWalletDisplay = updateWalletDisplay;
window.navigateToWalletTab = navigateToWalletTab;
window.updatePasswordButtonUI = updatePasswordButtonUI;
window.handlePasswordAction = handlePasswordAction;

/**
 * Show update email modal
 */
function showUpdateEmailModal() {
    const userData = TED_AUTH.getUser();

    // Check if user signed in with Google OAuth
    if (userData && userData.oauth_provider === 'google') {
        document.getElementById('google-oauth-email-notice').style.display = 'block';
        document.getElementById('update-email-btn').disabled = true;
        return;
    }

    const modal = document.getElementById('update-email-modal');
    modal.style.display = 'flex';

    // Pre-fill current email
    if (userData) {
        document.getElementById('current-email-display').value = userData.email;
    }

    // Reset form
    document.getElementById('update-email-form').reset();
    document.getElementById('current-email-display').value = userData.email;
}

/**
 * Close update email modal
 */
function closeUpdateEmailModal() {
    const modal = document.getElementById('update-email-modal');
    modal.style.display = 'none';
}

/**
 * Handle update email form submission
 */
async function handleUpdateEmail(event) {
    event.preventDefault();

    const newEmail = document.getElementById('new-email').value.trim();
    const password = document.getElementById('email-update-password').value;

    if (!newEmail || !password) {
        Swal.fire({ title: 'Warning', text: 'Please fill in all fields', icon: 'warning' });
        return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        Swal.fire({ title: 'Warning', text: 'Please enter a valid email address', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Sending verification code...');

        const response = await TED_AUTH.apiCall('/api/auth/request-email-update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_email: newEmail,
                password: password
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to send verification code');
        }

        // Store new email for verification step
        sessionStorage.setItem('pending_new_email', newEmail);

        // Close current modal and show verification modal
        closeUpdateEmailModal();
        showVerifyEmailUpdateModal(newEmail);

        Swal.fire({ title: 'Success!', text: 'Verification code sent to your new email address. Please check your inbox.', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Email update request error:', error);
        Swal.fire({ title: 'Error!', text: `Email update failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Show verify email update modal
 */
function showVerifyEmailUpdateModal(newEmail) {
    const modal = document.getElementById('verify-email-update-modal');
    modal.style.display = 'flex';

    // Display the email being verified
    document.getElementById('verification-email-display').textContent = newEmail;

    // Reset form
    document.getElementById('verify-email-update-form').reset();
}

/**
 * Close verify email update modal
 */
function closeVerifyEmailUpdateModal() {
    const modal = document.getElementById('verify-email-update-modal');
    modal.style.display = 'none';
    sessionStorage.removeItem('pending_new_email');
}

/**
 * Handle verify email update form submission
 */
async function handleVerifyEmailUpdate(event) {
    event.preventDefault();

    const code = document.getElementById('email-verification-code').value.trim();
    const newEmail = sessionStorage.getItem('pending_new_email');

    if (!code || code.length !== 6) {
        Swal.fire({ title: 'Warning', text: 'Please enter the 6-digit verification code', icon: 'warning' });
        return;
    }

    if (!newEmail) {
        Swal.fire({ title: 'Warning', text: 'Session expired. Please start the email update process again.', icon: 'warning' });
        closeVerifyEmailUpdateModal();
        return;
    }

    try {
        TED_AUTH.showLoading('Verifying code and updating email...');

        const response = await TED_AUTH.apiCall('/api/auth/verify-email-update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_email: newEmail,
                code: code
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Verification failed');
        }

        const result = await response.json();

        // Save new token if provided
        if (result.access_token) {
            TED_AUTH.saveToken(result.access_token);
        }

        // Update user data with new email
        const userData = TED_AUTH.getUser();
        if (userData) {
            userData.email = newEmail;
            TED_AUTH.saveUser(userData);
        }

        // Update email displays on page
        document.getElementById('user-email').textContent = newEmail;
        document.getElementById('security-user-email').textContent = newEmail;

        // Close modal
        closeVerifyEmailUpdateModal();

        Swal.fire({ title: 'Success!', text: 'Email address updated successfully! You can now use your new email to log in.', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Email verification error:', error);
        Swal.fire({ title: 'Error!', text: `Email verification failed: ${error.message}`, icon: 'error' });
    }
}

// Export email update functions
window.showUpdateEmailModal = showUpdateEmailModal;
window.closeUpdateEmailModal = closeUpdateEmailModal;
window.handleUpdateEmail = handleUpdateEmail;
window.showVerifyEmailUpdateModal = showVerifyEmailUpdateModal;
window.closeVerifyEmailUpdateModal = closeVerifyEmailUpdateModal;
window.handleVerifyEmailUpdate = handleVerifyEmailUpdate;

/**
 * Show Enable 2FA Modal
 */
function show2FAEnableModal() {
    const modal = document.getElementById('enable-2fa-modal');
    modal.style.display = 'flex';
    document.getElementById('enable-2fa-form').reset();
}

/**
 * Close Enable 2FA Modal
 */
function close2FAEnableModal() {
    const modal = document.getElementById('enable-2fa-modal');
    modal.style.display = 'none';
}

/**
 * Handle Enable 2FA Form Submission
 */
async function handleEnable2FA(event) {
    event.preventDefault();

    const password = document.getElementById('enable-2fa-password').value;

    if (!password) {
        Swal.fire({ title: 'Warning', text: 'Please enter your password', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Sending verification code...');

        const response = await TED_AUTH.apiCall('/api/auth/enable-2fa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: password
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to send verification code');
        }

        const result = await response.json();

        // Close enable modal and show verify modal
        close2FAEnableModal();
        show2FAVerifyModal(result.email);

        Swal.fire({ title: 'Success!', text: 'Verification code sent to your email. Please check your inbox.', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Enable 2FA error:', error);
        Swal.fire({ title: 'Error!', text: `Failed to enable 2FA: ${error.message}`, icon: 'error' });
    }
}

/**
 * Show 2FA Verify Modal
 */
function show2FAVerifyModal(email) {
    const modal = document.getElementById('verify-2fa-modal');
    modal.style.display = 'flex';
    document.getElementById('verify-2fa-form').reset();

    // Store email for verification
    modal.setAttribute('data-email', email);
}

/**
 * Close 2FA Verify Modal
 */
function close2FAVerifyModal() {
    const modal = document.getElementById('verify-2fa-modal');
    modal.style.display = 'none';
    modal.removeAttribute('data-email');
}

/**
 * Handle Verify 2FA Code Form Submission
 */
async function handleVerify2FA(event) {
    event.preventDefault();

    const modal = document.getElementById('verify-2fa-modal');
    const email = modal.getAttribute('data-email');
    const code = document.getElementById('verify-2fa-code').value.trim();

    if (!code || code.length !== 6) {
        Swal.fire({ title: 'Warning', text: 'Please enter the 6-digit verification code', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Verifying code and enabling 2FA...');

        const response = await TED_AUTH.apiCall('/api/auth/verify-enable-2fa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                code: code
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Verification failed');
        }

        const result = await response.json();

        // Update user data
        const userData = TED_AUTH.getUser();
        if (userData) {
            userData.two_fa_enabled = true;
            TED_AUTH.saveUser(userData);
        }

        // Update UI to show 2FA is enabled
        update2FAStatus(true);

        // Close modal
        close2FAVerifyModal();

        Swal.fire({ title: 'Success!', text: '2FA has been successfully enabled for your account!', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('2FA verification error:', error);
        Swal.fire({ title: 'Error!', text: `Verification failed: ${error.message}`, icon: 'error' });
    }
}

/**
 * Show Disable 2FA Modal
 */
function show2FADisableModal() {
    const modal = document.getElementById('disable-2fa-modal');
    modal.style.display = 'flex';
    document.getElementById('disable-2fa-form').reset();
}

/**
 * Close Disable 2FA Modal
 */
function close2FADisableModal() {
    const modal = document.getElementById('disable-2fa-modal');
    modal.style.display = 'none';
}

/**
 * Send 2FA Disable Code
 */
async function send2FADisableCode() {
    try {
        TED_AUTH.showLoading('Sending verification code...');

        const response = await TED_AUTH.apiCall('/api/auth/send-2fa-disable-code', {
            method: 'POST'
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to send verification code');
        }

        Swal.fire({ title: 'Success!', text: 'Verification code sent to your email. Please check your inbox and enter the code below.', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Send disable code error:', error);
        Swal.fire({ title: 'Error!', text: `Failed to send code: ${error.message}`, icon: 'error' });
    }
}

/**
 * Handle Disable 2FA Form Submission
 */
async function handleDisable2FA(event) {
    event.preventDefault();

    const password = document.getElementById('disable-2fa-password').value;
    const code = document.getElementById('disable-2fa-code').value.trim();

    if (!password || !code) {
        Swal.fire({ title: 'Warning', text: 'Please fill in all fields', icon: 'warning' });
        return;
    }

    if (code.length !== 6) {
        Swal.fire({ title: 'Warning', text: 'Please enter the 6-digit verification code', icon: 'warning' });
        return;
    }

    try {
        TED_AUTH.showLoading('Disabling 2FA...');

        const response = await TED_AUTH.apiCall('/api/auth/disable-2fa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: password,
                code: code
            })
        });

        TED_AUTH.closeLoading();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to disable 2FA');
        }

        const result = await response.json();

        // Update user data
        const userData = TED_AUTH.getUser();
        if (userData) {
            userData.two_fa_enabled = false;
            TED_AUTH.saveUser(userData);
        }

        // Update UI to show 2FA is disabled
        update2FAStatus(false);

        // Close modal
        close2FADisableModal();

        Swal.fire({ title: 'Success!', text: '2FA has been successfully disabled for your account.', icon: 'success' });
    } catch (error) {
        TED_AUTH.closeLoading();
        console.error('Disable 2FA error:', error);
        Swal.fire({ title: 'Error!', text: `Failed to disable 2FA: ${error.message}`, icon: 'error' });
    }
}

/**
 * Update 2FA Status in UI
 */
function update2FAStatus(enabled) {
    const statusBadge = document.getElementById('twofa-status-badge');
    const statusText = document.getElementById('twofa-status-text');
    const enableBtn = document.getElementById('enable-2fa-btn');
    const disableBtn = document.getElementById('disable-2fa-btn');

    if (enabled) {
        statusBadge.textContent = 'Enabled';
        statusBadge.className = 'badge-status badge-active';
        statusText.textContent = '2FA is currently enabled';
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'block';
    } else {
        statusBadge.textContent = 'Disabled';
        statusBadge.className = 'badge-status badge-inactive';
        statusText.textContent = '2FA is currently disabled';
        enableBtn.style.display = 'block';
        disableBtn.style.display = 'none';
    }
}

// Initialize 2FA status on page load
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit for user data to load
    setTimeout(() => {
        const userData = TED_AUTH.getUser();
        if (userData) {
            update2FAStatus(userData.two_fa_enabled || false);
        }
    }, 500);
});

// Export 2FA functions
window.show2FAEnableModal = show2FAEnableModal;
window.close2FAEnableModal = close2FAEnableModal;
window.handleEnable2FA = handleEnable2FA;
window.show2FAVerifyModal = show2FAVerifyModal;
window.close2FAVerifyModal = close2FAVerifyModal;
window.handleVerify2FA = handleVerify2FA;
window.show2FADisableModal = show2FADisableModal;
window.close2FADisableModal = close2FADisableModal;
window.send2FADisableCode = send2FADisableCode;
window.handleDisable2FA = handleDisable2FA;

/**
 * News Tab Functionality
 */

// Sample news data (in production, this would come from a real API)
let newsArticles = [];
let currentCategory = 'all';

/**
 * Load news articles when news tab is clicked
 * Tab-specific data loading is handled by loadTabData() in dashboard.html
 */

/**
 * Fetch news from API
 */
async function loadNewsArticles() {
    try {
        // Show loading state
        document.getElementById('news-articles-container').innerHTML =
            '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading news articles...</p>';
        document.getElementById('featured-news-container').innerHTML =
            '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">Loading featured news...</p>';

        // Fetch real news from backend API
        const response = await fetch('/api/news/articles?category=' + currentCategory);
        const data = await response.json();

        if (data.success && data.articles) {
            // Convert publishedAt strings to Date objects for formatting
            newsArticles = data.articles.map(article => ({
                ...article,
                publishedAt: new Date(article.publishedAt)
            }));

            // Display featured news
            displayFeaturedNews();

            // Display all news articles
            displayNewsArticles(newsArticles);
        } else {
            throw new Error('Failed to fetch news articles');
        }

    } catch (error) {
        console.error('Error loading news:', error);
        document.getElementById('news-articles-container').innerHTML =
            '<p style="text-align: center; color: #ff6b6b; padding: 40px 0;">Failed to load news. Please try again later.</p>';
    }
}

/**
 * Generate sample news data (replace with real API integration)
 */
function generateSampleNewsData() {
    return [
        {
            id: 1,
            title: 'Bitcoin Surges Past $50,000 as Institutional Interest Grows',
            description: 'Major cryptocurrency Bitcoin has broken through the $50,000 barrier following increased institutional investment and growing mainstream adoption.',
            category: 'crypto',
            source: 'CryptoNews',
            publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800&h=400&fit=crop',
            featured: true
        },
        {
            id: 2,
            title: 'Federal Reserve Hints at Interest Rate Cuts',
            description: 'The Federal Reserve has signaled potential interest rate reductions in the coming months as inflation continues to moderate.',
            category: 'markets',
            source: 'Financial Times',
            publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop',
            featured: true
        },
        {
            id: 3,
            title: 'Tech Stocks Rally on Strong Earnings Reports',
            description: 'Major technology companies exceed earnings expectations, driving a broad rally in the tech sector.',
            category: 'stocks',
            source: 'Bloomberg',
            publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop'
        },
        {
            id: 4,
            title: 'EUR/USD Reaches Multi-Year High',
            description: 'The Euro strengthens against the US Dollar, reaching its highest level in over three years amid improving European economic data.',
            category: 'forex',
            source: 'Reuters',
            publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800&h=400&fit=crop'
        },
        {
            id: 5,
            title: 'Gold Prices Soar on Economic Uncertainty',
            description: 'Investors flock to gold as a safe haven amid global economic concerns, pushing prices to record highs.',
            category: 'commodities',
            source: 'MarketWatch',
            publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&h=400&fit=crop'
        },
        {
            id: 6,
            title: 'Ethereum 2.0 Upgrade Shows Promising Results',
            description: 'The Ethereum network\'s transition to proof-of-stake continues to show strong performance metrics and reduced energy consumption.',
            category: 'crypto',
            source: 'CoinDesk',
            publishedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=800&h=400&fit=crop'
        },
        {
            id: 7,
            title: 'Oil Prices Stabilize After OPEC+ Meeting',
            description: 'Crude oil prices find stability following OPEC+ production quota agreements.',
            category: 'commodities',
            source: 'Energy News',
            publishedAt: new Date(Date.now() - 14 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1541190240878-fa985258c6d5?w=800&h=400&fit=crop'
        },
        {
            id: 8,
            title: 'Emerging Markets See Record Capital Inflows',
            description: 'Developing economies attract significant foreign investment as global risk appetite increases.',
            category: 'markets',
            source: 'Wall Street Journal',
            publishedAt: new Date(Date.now() - 16 * 60 * 60 * 1000),
            url: '#',
            imageUrl: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&h=400&fit=crop'
        }
    ];
}

/**
 * Display featured news
 */
function displayFeaturedNews() {
    const container = document.getElementById('featured-news-container');
    const featuredNews = newsArticles.filter(article => article.featured);

    if (featuredNews.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 20px 0;">No featured stories available.</p>';
        return;
    }

    container.innerHTML = featuredNews.map(article => `
        <div class="featured-news-card" onclick="openNewsArticle('${article.url}')">
            <span class="featured-news-badge">
                <i class="fa-solid fa-star"></i> Featured
            </span>
            <h3 class="news-article-title" style="font-size: 20px; margin-bottom: 12px;">${article.title}</h3>
            <p class="news-article-description">${article.description}</p>
            <div class="news-article-meta">
                <span class="news-article-source">
                    <i class="fa-solid fa-newspaper"></i>
                    ${article.source}
                </span>
                <span class="news-article-date">
                    <i class="fa-solid fa-clock"></i>
                    ${formatNewsDate(article.publishedAt)}
                </span>
            </div>
        </div>
    `).join('');
}

/**
 * Display news articles
 */
function displayNewsArticles(articles) {
    const container = document.getElementById('news-articles-container');

    if (articles.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px 0;">No articles found for this category.</p>';
        return;
    }

    container.innerHTML = `<div class="news-grid">` + articles.map(article => `
        <div class="news-article-card" onclick="openNewsArticle('${article.url}')">
            <img src="${article.imageUrl}" alt="${article.title}" class="news-article-image"
                onerror="this.src='https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=800&h=400&fit=crop'">
            <span class="news-article-category">${article.category}</span>
            <h4 class="news-article-title">${article.title}</h4>
            <p class="news-article-description">${article.description}</p>
            <div class="news-article-meta">
                <span class="news-article-source">
                    <i class="fa-solid fa-newspaper"></i>
                    ${article.source}
                </span>
                <span class="news-article-date">
                    <i class="fa-solid fa-clock"></i>
                    ${formatNewsDate(article.publishedAt)}
                </span>
            </div>
        </div>
    `).join('') + `</div>`;
}

/**
 * Filter news by category
 */
async function filterNewsByCategory(category) {
    currentCategory = category;

    // Update active button
    document.querySelectorAll('.news-category-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.news-category-btn[data-category="${category}"]`).classList.add('active');

    // Reload news with selected category
    await loadNewsArticles();
}

/**
 * Format news date to relative time
 */
function formatNewsDate(date) {
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 60) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else if (hours < 24) {
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else {
        const days = Math.floor(hours / 24);
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    }
}

/**
 * Open news article in new tab
 */
function openNewsArticle(url) {
    if (url && url !== '#') {
        window.open(url, '_blank');
    }
}

// Export news functions
window.filterNewsByCategory = filterNewsByCategory;
window.openNewsArticle = openNewsArticle;

// ============================================================
// NOTIFICATIONS
// ============================================================

/**
 * Load and display user notifications
 */
async function loadNotifications() {
    try {
        const response = await TED_AUTH.apiCall('/api/notifications/active');
        const notifications = await response.json();

        const container = document.getElementById('notifications-area');
        if (!container) return;

        // Clear existing notifications
        container.innerHTML = '';

        if (notifications.length === 0) {
            return; // Don't show anything if no notifications
        }

        // Display each notification
        notifications.forEach(notif => {
            const notificationEl = createNotificationElement(notif);
            container.appendChild(notificationEl);
        });

    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

/**
 * Create notification DOM element
 */
function createNotificationElement(notification) {
    const div = document.createElement('div');
    div.className = `notification-banner ${notification.notification_type}`;
    div.setAttribute('data-notification-id', notification.id);

    // Get icon based on type
    const icons = {
        'info': 'fa-info-circle',
        'success': 'fa-check-circle',
        'warning': 'fa-exclamation-triangle',
        'error': 'fa-times-circle'
    };
    const iconClass = icons[notification.notification_type] || 'fa-bell';

    div.innerHTML = `
        <div class="notification-icon">
            <i class="fas ${iconClass}"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${escapeHtml(notification.title)}</div>
            <div class="notification-message">${escapeHtml(notification.message)}</div>
        </div>
        <button class="notification-dismiss" onclick="dismissNotification('${notification.id}')" aria-label="Dismiss">
            <i class="fas fa-times"></i>
        </button>
    `;

    return div;
}

/**
 * Dismiss a notification
 */
async function dismissNotification(notificationId) {
    try {
        const response = await TED_AUTH.apiCall(`/api/notifications/${notificationId}/dismiss`, {
            method: 'PUT'
        });

        if (response.ok) {
            // Remove notification from DOM with animation
            const notificationEl = document.querySelector(`[data-notification-id="${notificationId}"]`);
            if (notificationEl) {
                notificationEl.style.animation = 'slideUp 0.3s ease';
                setTimeout(() => {
                    notificationEl.remove();

                    // Check if notifications area is empty
                    const container = document.getElementById('notifications-area');
                    if (container && container.children.length === 0) {
                        container.style.display = 'none';
                    }
                }, 300);
            }
        }
    } catch (error) {
        console.error('Error dismissing notification:', error);
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export notification functions
window.loadNotifications = loadNotifications;
window.dismissNotification = dismissNotification;

/**
 * Disable sidebar menu items (except logout) for users without access_granted
 */
function disableSidebarMenus() {
    // Get all sidebar menu items
    const menuItems = document.querySelectorAll('.app-bar-menu a, .app-bar-menu .menu-item, .left-panel a, .left-panel .menu-item');

    menuItems.forEach(item => {
        // NEVER disable logout button - check multiple conditions to be safe
        const onclick = item.getAttribute('onclick') || '';
        const classList = item.classList || [];

        // Skip if this is a logout button (check class, onclick, or text content)
        if (classList.contains('logout-btn') ||
            onclick.includes('logout') ||
            onclick.includes('handleLogout') ||
            onclick.includes('TED_AUTH.logout')) {
            return; // Skip logout button - NEVER disable it
        }

        // Disable the menu item
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
        item.style.pointerEvents = 'none';

        // Add a title attribute to explain why it's disabled
        item.setAttribute('title', 'Dashboard access pending admin approval');
    });

    // Also disable any action buttons in the main content area
    // Explicitly exclude logout buttons by class and any button with logout in onclick
    const actionButtons = document.querySelectorAll('.btn');
    actionButtons.forEach(btn => {
        // NEVER disable logout button - multiple safety checks
        const onclick = btn.getAttribute('onclick') || '';
        const classList = btn.classList || [];

        if (classList.contains('logout-btn') ||
            onclick.includes('logout') ||
            onclick.includes('handleLogout') ||
            onclick.includes('TED_AUTH.logout')) {
            return; // Skip logout button - NEVER disable it
        }

        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.setAttribute('title', 'Dashboard access pending admin approval');
    });

    // Disable and blur the Quick Actions card for users without access_granted
    const quickActionsCard = document.getElementById('quick-actions-card');
    if (quickActionsCard) {
        console.log('Found Quick Actions card, disabling it now...');
        quickActionsCard.classList.add('kyc-pending');
        quickActionsCard.setAttribute('data-kyc-disabled', 'true');

        // Get the quick actions grid and disable it
        const quickActionsGrid = quickActionsCard.querySelector('.quick-actions-grid');
        if (quickActionsGrid) {
            quickActionsGrid.classList.add('disabled');
            console.log('Applied disabled class to quick-actions-grid');

            // Disable all buttons individually
            const buttons = quickActionsGrid.querySelectorAll('button');
            console.log(`Found ${buttons.length} quick action buttons to disable`);

            buttons.forEach((button, index) => {
                button.classList.add('disabled');
                button.setAttribute('disabled', 'true');
                button.style.cursor = 'not-allowed';

                // Store original onclick handler
                const originalOnclick = button.getAttribute('onclick');
                if (originalOnclick) {
                    button.setAttribute('data-original-onclick', originalOnclick);
                    button.removeAttribute('onclick');
                }

                // Add click handler to show access pending warning
                const accessPendingHandler = function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'warning',
                            title: '⏳ Access Pending',
                            html: '<p style="font-size: 16px; line-height: 1.6;">Your KYC documents are under review. You will be able to access Quick Actions once admin approves your account.</p>',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#ea580c'
                        });
                    } else {
                        alert('Your account is pending admin approval. Please wait for verification.');
                    }
                    return false;
                };

                button.addEventListener('click', accessPendingHandler, true);
                button.setAttribute('data-access-pending-attached', 'true');
                console.log(`Disabled quick action button ${index + 1}: ${button.textContent.trim()}`);
            });
        } else {
            console.warn('Quick Actions grid not found inside card');
        }

        console.log('✓ Successfully disabled and blurred Quick Actions card - pending admin approval');
    } else {
        console.warn('Quick Actions card element not found in DOM');
    }
}

/**
 * Show a banner notification about pending approval status
 */
function showPendingApprovalBanner() {
    // Check if banner already exists
    if (document.getElementById('pending-approval-banner')) {
        return;
    }

    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'pending-approval-banner';
    banner.style.cssText = `
        background: linear-gradient(135deg, #ffeaa7, #fdcb6e);
        border: 2px solid #ffc107;
        border-radius: 12px;
        padding: 20px;
        margin: 20px;
        box-shadow: 0 4px 12px rgba(255, 193, 7, 0.3);
        animation: slideDown 0.5s ease;
    `;

    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-size: 20px;">
                <i class="fas fa-hourglass-half" style="color: #f39c12; animation: pulse 2s infinite;"></i>
            </div>
            <div style="flex: 1;">
                <h3 style="margin: 0 0 4px 0; color: #856404; font-size: 12px; font-weight: 600;">
                    <i class="fas fa-lock" style="font-size: 10px;"></i> Dashboard Access Pending Approval
                </h3>
                <p style="margin: 0; color: #856404; line-height: 1.4; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
                    Your account has been created and your onboarding information is under review.
                    Dashboard features will be unlocked once an admin approves your account.
                    This typically takes <strong>less than 24 hours</strong>.
                </p>
                <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                    <button onclick="checkAccessStatus()" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
                        <i class="fas fa-sync-alt" style="font-size: 10px;"></i> Check Status
                    </button>
                    <span style="color: #856404; font-size: 10px;">
                        <i class="fas fa-info-circle" style="font-size: 9px;"></i> Auto-checking every 30 seconds
                    </span>
                </div>
            </div>
        </div>
    `;

    // Add pulse animation style if not already present
    if (!document.getElementById('pulse-animation-style')) {
        const style = document.createElement('style');
        style.id = 'pulse-animation-style';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Insert banner at the top of main content area
    const mainContent = document.querySelector('.main-content') || document.querySelector('main') || document.body;
    mainContent.insertBefore(banner, mainContent.firstChild);

    // Set up auto-check every 30 seconds
    window.accessCheckInterval = setInterval(checkAccessStatus, 30000);
}

/**
 * Check if user's access has been granted and reload if so
 */
async function checkAccessStatus() {
    try {
        const result = await TED_AUTH.fetchCurrentUser();

        if (result.success && result.data.access_granted) {
            // Access has been granted! Show success message and reload
            TED_AUTH.showSuccess('Dashboard access granted! Reloading...');

            // Clear the interval
            if (window.accessCheckInterval) {
                clearInterval(window.accessCheckInterval);
            }

            // Reload the page after a short delay
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        }
    } catch (error) {
        console.error('Error checking access status:', error);
    }
}

// Fetch and Display Active Plans with Progress
async function loadActivePlans() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/api/investments/active-plans', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) return;

        const data = await response.json();

        // Render General Plans
        renderActivePlans(data.general_plans, 'general-active-plans-container', 'General');

        // Render ETF Plans
        renderActivePlans(data.etf_plans, 'etf-active-plans-container', 'ETF');

        // Render DeFi Plans
        renderActivePlans(data.defi_plans, 'defi-active-plans-container', 'DeFi');

        // Render Options Plans
        renderActivePlans(data.options_plans, 'options-active-plans-container', 'Options');

    } catch (error) {
        console.error('Error loading active plans:', error);
    }
}

function renderActivePlans(plans, containerId, planType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!plans || plans.length === 0) {
        container.innerHTML = '';
        return;
    }

    const plansHTML = plans.map(plan => {
        const performanceClass = plan.profit_loss_percent >= 0 ? 'positive' : 'negative';
        const performanceSign = plan.profit_loss_percent >= 0 ? '+' : '';

        return `
            <div class="active-plan-card">
                <div class="active-plan-header">
                    <div>
                        <h4 class="active-plan-title">${plan.plan_name}</h4>
                        <p class="active-plan-amount">Invested: $${plan.amount_invested.toLocaleString()}</p>
                    </div>
                    <div class="active-plan-performance">
                        <p class="performance-value ${performanceClass}">${performanceSign}${plan.profit_loss_percent}%</p>
                        <p class="performance-label">Return</p>
                    </div>
                </div>
                <div class="progress-section">
                    <div class="progress-bar-wrapper">
                        <div class="progress-bar-fill" style="width: ${plan.progress_percent}%"></div>
                    </div>
                    <div class="progress-info">
                        <span>${Math.round(plan.progress_percent)}% Complete</span>
                        <span>${plan.time_remaining} remaining</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = plansHTML;
}

// Call loadActivePlans when dashboard loads
document.addEventListener('DOMContentLoaded', function() {
    loadActivePlans();
});

// Export access control functions
window.disableSidebarMenus = disableSidebarMenus;
window.showPendingApprovalBanner = showPendingApprovalBanner;
window.checkAccessStatus = checkAccessStatus;

// Export network functions
window.loadRecentTrades = loadRecentTrades;
window.loadPosts = loadPosts;
window.likePost = likePost;
window.dislikePost = dislikePost;
window.viewAllTraderTrades = viewAllTraderTrades;
