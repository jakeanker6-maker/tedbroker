const API_BASE = '';
let currentTab = 'dashboard';

// Simple TED_AUTH helper for loading indicators
const TED_AUTH = {
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
    closeLoading() {
        if (typeof Swal !== 'undefined') {
            Swal.close();
        }
    }
};

// Check authentication on load
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
        window.location.href = '/admin/login';
        return;
    }
    
    try {
        const response = await adminFetch('/api/admin/me');
        if (!response.ok) throw new Error('Unauthorized');
        
        const admin = await response.json();
        document.getElementById('admin-name').textContent = admin.full_name || admin.username;
        
        loadDashboardStats();
        setupTabSwitching();
    } catch (error) {
        localStorage.removeItem('admin_token');
        window.location.href = '/admin/login';
    }


    // ============================================================================
    // EVENT LISTENERS - Restore functionality after CSP compliance
    // ============================================================================

    // Static buttons in HTML (not dynamically generated)
    // Search Users button
    const searchUsersBtn = document.querySelector('button[onclick*="searchUsers"]');
    if (searchUsersBtn) {
        searchUsersBtn.removeAttribute('onclick');
        searchUsersBtn.addEventListener('click', searchUsers);
    }

    // Add Trader button (in HTML)
    document.querySelectorAll('.btn.btn-primary').forEach(btn => {
        const text = btn.textContent.trim();
        if (text.includes('Add Trader')) {
            btn.addEventListener('click', showAddTraderModal);
        } else if (text.includes('Add Plan')) {
            btn.addEventListener('click', showAddPlanModal);
        } else if (text.includes('Add ETF Plan')) {
            btn.addEventListener('click', showAddETFPlanModal);
        } else if (text.includes('Add DeFi Plan')) {
            btn.addEventListener('click', showAddDeFiPlanModal);
        } else if (text.includes('Add Options Plan')) {
            btn.addEventListener('click', showAddOptionsPlanModal);
        } else if (text.includes('Add Bank Account')) {
            btn.addEventListener('click', showAddBankAccountModal);
        } else if (text.includes('Add Crypto Wallet')) {
            btn.addEventListener('click', showAddCryptoWalletModal);
        } else if (text.includes('Create Notification')) {
            btn.addEventListener('click', showCreateNotificationModal);
        }
    });

    // Filter buttons in HTML
    document.querySelectorAll('.btn.btn-primary').forEach(btn => {
        const text = btn.textContent.trim();
        if (text.includes('Filter') && btn.closest('#tab-deposits')) {
            btn.addEventListener('click', filterDepositRequests);
        } else if (text.includes('Filter') && btn.closest('#tab-withdrawals')) {
            btn.addEventListener('click', filterWithdrawalRequests);
        } else if (text.includes('Filter') && btn.closest('#tab-chats')) {
            btn.addEventListener('click', filterChats);
        }
    });

    // Send Admin Message button
    document.querySelectorAll('.btn.btn-primary').forEach(btn => {
        if (btn.textContent.trim().includes('Send')) {
            btn.addEventListener('click', sendAdminMessage);
        }
    });

    // Close Conversation button
    document.querySelectorAll('.btn.btn-success').forEach(btn => {
        if (btn.textContent.trim().includes('Close')) {
            btn.addEventListener('click', closeConversation);
        }
    });

    // Modal close buttons (Cancel/Close)
    document.querySelectorAll('.btn.btn-secondary').forEach(btn => {
        const text = btn.textContent.trim();
        if (text === 'Cancel' || text === 'Close') {
            const modal = btn.closest('.modal');
            if (modal) {
                const modalId = modal.id;
                const closeHandlers = {
                    'addTraderModal': closeAddTraderModal,
                    'editTraderModal': hideEditTraderModal,
                    'addPlanModal': hideAddPlanModal,
                    'editPlanModal': hideEditPlanModal,
                    'addETFPlanModal': hideAddETFPlanModal,
                    'editETFPlanModal': hideEditETFPlanModal,
                    'addDeFiPlanModal': hideAddDeFiPlanModal,
                    'editDeFiPlanModal': hideEditDeFiPlanModal,
                    'addOptionsPlanModal': hideAddOptionsPlanModal,
                    'editOptionsPlanModal': hideEditOptionsPlanModal,
                    'addCryptoWalletModal': hideAddCryptoWalletModal,
                    'editCryptoWalletModal': hideEditCryptoWalletModal,
                    'userDetailsModal': closeUserDetailsModal,
                    'createNotificationModal': hideCreateNotificationModal,
                    'addBankAccountModal': hideAddBankAccountModal,
                    'withdrawalDetailsModal': closeWithdrawalDetailsModal,
                    'updateBalanceModal': closeUpdateBalanceModal
                };
                if (closeHandlers[modalId]) {
                    btn.addEventListener('click', closeHandlers[modalId]);
                }
            }
        }
    });

    // User details modal tabs
    document.querySelectorAll('.user-tab-btn').forEach(btn => {
        const tab = btn.getAttribute('data-tab');
        if (tab) {
            btn.addEventListener('click', function() {
                switchUserTab(tab);
            });
        }
    });

    // Logout button
    const logoutMenuItem = document.querySelector('.menu-item[style*="border-top"]');
    if (logoutMenuItem && logoutMenuItem.textContent.includes('Logout')) {
        logoutMenuItem.addEventListener('click', logout);
    }

    // ============================================================================
    // EVENT DELEGATION FOR DYNAMICALLY GENERATED CONTENT
    // ============================================================================
    // This handles buttons in dynamically generated HTML (users, traders, plans tables)
    // that use data attributes instead of onclick handlers (for CSP compliance)

    function setupDynamicEventDelegation() {
        // Delegate clicks on dynamically generated buttons
        document.addEventListener('click', function(e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.getAttribute('data-action');
            const userId = btn.getAttribute('data-user-id');
            const traderId = btn.getAttribute('data-trader-id');
            const planId = btn.getAttribute('data-plan-id');
            const requestId = btn.getAttribute('data-request-id');
            const walletId = btn.getAttribute('data-wallet-id');
            const accountId = btn.getAttribute('data-account-id');
            const notificationId = btn.getAttribute('data-notification-id');
            const conversationId = btn.getAttribute('data-conversation-id');
            const balance = btn.getAttribute('data-balance');

            switch (action) {
                // User actions
                case 'view-user':
                    if (userId) viewUser(userId);
                    break;
                case 'activate-user':
                    if (userId) activateUser(userId);
                    break;
                case 'deactivate-user':
                    if (userId) deactivateUser(userId);
                    break;
                case 'grant-access':
                    if (userId) grantAccess(userId);
                    break;
                case 'revoke-access':
                    if (userId) revokeAccess(userId);
                    break;
                case 'reject-kyc':
                    if (userId) rejectKYC(userId);
                    break;
                case 'update-balance':
                    if (userId && balance !== null) showUpdateBalanceModal(userId, parseFloat(balance));
                    break;

                // Trader actions
                case 'edit-trader':
                    if (traderId) showEditTraderModal(traderId);
                    break;
                case 'delete-trader':
                    if (traderId) deleteTrader(traderId);
                    break;

                // Plan actions (Investment Plans)
                case 'edit-plan':
                    if (planId) showEditPlanModal(planId);
                    break;
                case 'delete-plan':
                    if (planId) deletePlan(planId);
                    break;

                // ETF Plan actions
                case 'edit-etf-plan':
                    if (planId) showEditETFPlanModal(planId);
                    break;
                case 'delete-etf-plan':
                    if (planId) deleteETFPlan(planId);
                    break;

                // DeFi Plan actions
                case 'edit-defi-plan':
                    if (planId) showEditDeFiPlanModal(planId);
                    break;
                case 'delete-defi-plan':
                    if (planId) deleteDeFiPlan(planId);
                    break;

                // Options Plan actions
                case 'edit-options-plan':
                    if (planId) showEditOptionsPlanModal(planId);
                    break;
                case 'delete-options-plan':
                    if (planId) deleteOptionsPlan(planId);
                    break;

                // Deposit actions
                case 'approve-deposit':
                    if (requestId) approveDeposit(requestId);
                    break;
                case 'reject-deposit':
                    if (requestId) rejectDeposit(requestId);
                    break;

                // Withdrawal actions (old-style requests)
                case 'view-withdrawal':
                    if (requestId) viewWithdrawalDetails(requestId);
                    break;
                case 'approve-withdrawal':
                    if (requestId) approveWithdrawal(requestId);
                    break;
                case 'reject-withdrawal':
                    if (requestId) rejectWithdrawal(requestId);
                    break;

                // Transaction-based withdrawal actions
                case 'view-transaction-withdrawal':
                    if (requestId) viewTransactionWithdrawalDetails(requestId);
                    break;
                case 'complete-transaction-withdrawal':
                    if (requestId) completeTransactionWithdrawal(requestId);
                    break;
                case 'reject-transaction-withdrawal':
                    if (requestId) rejectTransactionWithdrawal(requestId);
                    break;

                // Crypto wallet actions
                case 'edit-crypto-wallet':
                    if (walletId) showEditCryptoWalletModal(walletId);
                    break;
                case 'delete-crypto-wallet':
                    if (walletId) deleteCryptoWallet(walletId);
                    break;

                // Bank account actions
                case 'delete-bank-account':
                    if (accountId) deleteBankAccount(accountId);
                    break;

                // Notification actions
                case 'delete-notification':
                    if (notificationId) deleteNotification(notificationId);
                    break;

                // User selection in notification modal
                case 'select-user-notification':
                    if (userId) {
                        const username = btn.getAttribute('data-username');
                        const email = btn.getAttribute('data-email');
                        selectUserForNotification(userId, username, email);
                    }
                    break;

                // Chat actions
                case 'select-conversation':
                    if (conversationId && window.adminChatManager) {
                        window.adminChatManager.selectConversation(conversationId);
                    }
                    break;

                // Empty state buttons (show modals when no data exists)
                case 'show-add-trader-modal':
                    showAddTraderModal();
                    break;
                case 'show-add-plan-modal':
                    showAddPlanModal();
                    break;
                case 'show-add-etf-plan-modal':
                    showAddETFPlanModal();
                    break;
                case 'show-add-defi-plan-modal':
                    showAddDeFiPlanModal();
                    break;
                case 'show-add-options-plan-modal':
                    showAddOptionsPlanModal();
                    break;
                case 'show-add-bank-account-modal':
                    showAddBankAccountModal();
                    break;
                case 'show-add-crypto-wallet-modal':
                    showAddCryptoWalletModal();
                    break;
                case 'show-create-notification-modal':
                    showCreateNotificationModal();
                    break;

                default:
                    console.warn('Unknown action:', action);
            }
        });
    }

    // Initialize dynamic event delegation
    setupDynamicEventDelegation();

    // Also handle legacy data-id/data-user-id attributes (from fix_admin_onclick.py)
    // These don't have data-action but use button text/context to determine action
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('button[data-user-id], button[data-trader-id], button[data-plan-id], button[data-request-id], button[data-wallet-id], button[data-account-id], button[data-notification-id]');
        if (!btn || btn.hasAttribute('data-action')) return; // Skip if already handled by data-action

        // Determine action from button text/content
        const text = btn.textContent.trim();
        const userId = btn.getAttribute('data-user-id');
        const traderId = btn.getAttribute('data-trader-id');
        const planId = btn.getAttribute('data-plan-id');
        const requestId = btn.getAttribute('data-request-id');
        const walletId = btn.getAttribute('data-wallet-id');
        const accountId = btn.getAttribute('data-account-id');
        const notificationId = btn.getAttribute('data-notification-id');
        const balance = btn.getAttribute('data-balance');

        // User buttons (in loadUsers)
        if (userId) {
            if (text.includes('Full Details') || text.includes('View')) {
                viewUser(userId);
            } else if (text.includes('Reject KYC')) {
                rejectKYC(userId);
            } else if (text.includes('Grant Access')) {
                grantAccess(userId);
            } else if (text.includes('Revoke Access')) {
                revokeAccess(userId);
            } else if (text.includes('Activate')) {
                activateUser(userId);
            } else if (text.includes('Deactivate')) {
                deactivateUser(userId);
            } else if (text.includes('Update') && balance !== null) {
                showUpdateBalanceModal(userId, parseFloat(balance));
            }
        }

        // Trader buttons (in loadTraders)
        if (traderId) {
            if (text.includes('Edit')) {
                showEditTraderModal(traderId);
            } else if (text.includes('Delete')) {
                deleteTrader(traderId);
            }
        }

        // Plan buttons (in loadPlans, loadETFPlans, loadDeFiPlans, loadOptionsPlans)
        if (planId) {
            if (text.includes('Edit')) {
                // Determine which plan type based on current tab
                if (currentTab === 'etf-plans') showEditETFPlanModal(planId);
                else if (currentTab === 'defi-plans') showEditDeFiPlanModal(planId);
                else if (currentTab === 'options-plans') showEditOptionsPlanModal(planId);
                else showEditPlanModal(planId);
            } else if (text.includes('Delete')) {
                if (currentTab === 'etf-plans') deleteETFPlan(planId);
                else if (currentTab === 'defi-plans') deleteDeFiPlan(planId);
                else if (currentTab === 'options-plans') deleteOptionsPlan(planId);
                else deletePlan(planId);
            }
        }

        // Deposit request buttons
        if (requestId && currentTab === 'deposits') {
            if (text.includes('Approve')) approveDeposit(requestId);
            else if (text.includes('Reject')) rejectDeposit(requestId);
        }

        // Withdrawal request buttons
        if (requestId && currentTab === 'withdrawals') {
            if (text.includes('View')) viewWithdrawalDetails(requestId);
            else if (text.includes('Approve')) approveWithdrawal(requestId);
            else if (text.includes('Reject')) rejectWithdrawal(requestId);
            else if (text.includes('Complete')) completeTransactionWithdrawal(requestId);
        }

        // Crypto wallet buttons
        if (walletId && currentTab === 'crypto-wallets') {
            if (text.includes('Edit')) showEditCryptoWalletModal(walletId);
            else if (text.includes('Delete')) deleteCryptoWallet(walletId);
        }

        // Bank account buttons
        if (accountId && currentTab === 'bank-accounts') {
            if (text.includes('Delete')) deleteBankAccount(accountId);
        }

        // Notification buttons
        if (notificationId && currentTab === 'notifications') {
            if (text.includes('Delete')) deleteNotification(notificationId);
        }
    });

    console.log('✓ All admin dashboard event listeners restored after CSP compliance');

});

// Admin authenticated fetch
async function adminFetch(url, options = {}) {
    const token = localStorage.getItem('admin_token');
    return fetch(API_BASE + url, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

// Setup tab switching
function setupTabSwitching() {
    console.log('Setting up tab switching...');
    const menuItems = document.querySelectorAll('.menu-item[data-tab]');
    console.log('Found menu items:', menuItems.length);
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.getAttribute('data-tab');
            console.log('Switching to tab:', tab);
            switchTab(tab);
        });
    });
}

// Switch tabs
function switchTab(tab) {
    console.log('switchTab called with tab:', tab);

    // Remove active class from all menu items
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

    // Add active class to selected menu item
    const selectedMenuItem = document.querySelector(`.menu-item[data-tab="${tab}"]`);
    console.log('Selected menu item:', selectedMenuItem);
    if (selectedMenuItem) {
        selectedMenuItem.classList.add('active');
    }

    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    // Show selected tab content
    const selectedTab = document.getElementById(`tab-${tab}`);
    console.log('Selected tab content:', selectedTab);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    currentTab = tab;
    syncMenuCurrent();

    // Load data for specific tabs
    if (tab === 'users') loadUsers();
    if (tab === 'traders') loadTraders();
    if (tab === 'plans') loadPlans();
    if (tab === 'etf-plans') loadETFPlans();
    if (tab === 'defi-plans') loadDeFiPlans();
    if (tab === 'options-plans') loadOptionsPlans();
    if (tab === 'deposits') loadDepositRequests();
    if (tab === 'withdrawals') { loadWithdrawalRequests(); loadPayoutAccounts(); }
    if (tab === 'bank-accounts') loadBankAccounts();
    if (tab === 'crypto-wallets') loadCryptoWallets();
    if (tab === 'notifications') loadNotifications();
    if (tab === 'trading-activity' && window.tradingActivity) window.tradingActivity.open();
    if (tab === 'chats') {
        // Initialize chat manager if not already initialized
        if (typeof window.adminChatManager !== 'undefined') {
            window.adminChatManager.init();
        }
    }
}

// Load dashboard statistics
async function loadDashboardStats() {
    try {
        const response = await adminFetch('/api/admin/statistics');
        const stats = await response.json();
        
        document.getElementById('stat-total-users').textContent = stats.users.total;
        document.getElementById('stat-active-users').textContent = stats.users.active;
        document.getElementById('stat-total-balance').textContent = `$${stats.wallet.total_balance.toLocaleString()}`;
        document.getElementById('stat-total-traders').textContent = stats.traders.total;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// ----------------------------------------------------------------------------
// Users table
// The list is rendered from a single request to /api/admin/users. Full details
// (KYC, login history, trading) are fetched only when a row's Details button
// is pressed, inside the user details modal.
// ----------------------------------------------------------------------------

let usersSearch = '';
let usersLoadSeq = 0; // guards against out-of-order responses from rapid searches
let userDetailSeq = 0; // guards the details modal against out-of-order user responses

const USER_MONEY_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Build an element with textContent-safe children (no innerHTML for API data)
function userEl(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'className') node.className = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) {
        if (child === null || child === undefined) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

// Load users (single request, no per-user follow-up calls)
async function loadUsers(search = usersSearch) {
    usersSearch = search;
    const container = document.getElementById('users-table-container');
    const seq = ++usersLoadSeq;

    container.setAttribute('aria-busy', 'true');
    container.replaceChildren(userEl('p', { className: 'users-status' }, 'Loading users...'));

    try {
        const url = search ? `/api/admin/users?search=${encodeURIComponent(search)}` : '/api/admin/users';
        const response = await adminFetch(url);
        if (!response.ok) throw new Error(`Users request failed: ${response.status}`);
        const data = await response.json();

        if (seq !== usersLoadSeq) return; // a newer request has superseded this one
        renderUsersTable(container, data);
    } catch (error) {
        if (seq !== usersLoadSeq) return;
        console.error('Error loading users:', error);
        const retry = userEl('button', { type: 'button', className: 'btn btn-primary btn-sm' }, 'Retry');
        retry.addEventListener('click', () => loadUsers(usersSearch));
        container.replaceChildren(
            userEl('p', { className: 'users-status users-status--error', role: 'alert' },
                'Error loading users. ', retry)
        );
    } finally {
        if (seq === usersLoadSeq) container.removeAttribute('aria-busy');
    }
}

function renderUsersTable(container, data) {
    const users = data.users || [];

    if (users.length === 0) {
        container.replaceChildren(userEl('p', { className: 'users-status' },
            usersSearch ? 'No users match your search.' : 'No users found.'));
        return;
    }

    const headers = ['Username', 'Email', 'Full name', 'Wallet balance', 'Status', 'Joined'];
    const headRow = userEl('tr', {}, ...headers.map(label => userEl('th', {
            scope: 'col',
            className: label === 'Wallet balance' ? 'is-num' : undefined
        }, label)),
        userEl('th', { scope: 'col' }, userEl('span', { className: 'visually-hidden' }, 'Actions')));

    const rows = users.map(user => {
        const joined = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A';
        const balance = Number(user.wallet_balance || 0);
        const status = userEl('span', { className: `badge ${user.is_active ? 'badge-active' : 'badge-inactive'}` },
            user.is_active ? 'Active' : 'Inactive');
        const details = userEl('button', {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            'data-action': 'view-user',
            'data-user-id': user.id,
            'aria-label': `View full details for ${user.username}`
        }, userEl('i', { className: 'fas fa-eye', 'aria-hidden': 'true' }), ' Details');

        return userEl('tr', {},
            userEl('td', {}, user.username || '-'),
            userEl('td', {}, user.email || '-'),
            userEl('td', {}, user.full_name || '-'),
            userEl('td', { className: 'is-num' }, `$${USER_MONEY_FMT.format(balance)}`),
            userEl('td', {}, status),
            userEl('td', {}, joined),
            userEl('td', {}, details)
        );
    });

    const table = userEl('table', { className: 'users-table' },
        userEl('caption', { className: 'visually-hidden' }, 'Users'),
        userEl('thead', {}, headRow),
        userEl('tbody', {}, ...rows));

    const summary = userEl('p', { className: 'users-summary', role: 'status' },
        `Showing ${users.length} of ${data.total ?? users.length} users`,
        (data.total ?? 0) > users.length ? ' - narrow your search to see others.' : '.');

    container.replaceChildren(userEl('div', {
        className: 'table-wrap',
        tabindex: '0',
        role: 'region',
        'aria-label': 'Users table'
    }, table), summary);
}

// Search users
function searchUsers() {
    const search = document.getElementById('user-search').value.trim();
    loadUsers(search);
}

// Refresh the list after a user action. If the details modal is open for this
// user, reload it so the modal reflects the new state.
function onUserChanged(userId) {
    loadUsers();
    const modal = document.getElementById('user-details-modal');
    if (userId && modal && modal.classList.contains('show')) viewUser(userId);
}


// View user details
async function viewUser(userId) {
    const modal = document.getElementById('user-details-modal');
    const loading = document.getElementById('user-details-loading');
    const content = document.getElementById('user-details-content');

    // Show modal and loading state
    modal.classList.add('show');
    loading.style.display = 'block';
    content.style.display = 'none';

    const seq = ++userDetailSeq;
    try {
        const response = await adminFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        // Ignore a response for a user the admin has since opened or refreshed
        if (seq !== userDetailSeq) return;

        // Populate overview tab
        document.getElementById('detail-username').textContent = user.username || '-';
        document.getElementById('detail-email').textContent = user.email || '-';
        document.getElementById('detail-fullname').textContent = user.full_name || '-';
        document.getElementById('detail-phone').textContent = user.phone || '-';
        document.getElementById('detail-gender').textContent = user.gender || '-';
        document.getElementById('detail-country').textContent = user.country || '-';
        document.getElementById('detail-wallet').textContent = `$${user.wallet_balance.toLocaleString()}`;

        // Status badge
        const statusBadge = user.is_active ?
            '<span class="badge badge-active">Active</span>' :
            '<span class="badge badge-inactive">Inactive</span>';
        document.getElementById('detail-status').innerHTML = statusBadge;

        document.getElementById('detail-2fa').textContent = user.two_fa_enabled ? 'Yes' : 'No';
        document.getElementById('detail-auth-provider').textContent = user.auth_provider || 'local';
        document.getElementById('detail-referral-code').textContent = user.referral_code || '-';
        document.getElementById('detail-referred-by').textContent = user.referred_by || '-';
        document.getElementById('detail-created').textContent = user.created_at ? new Date(user.created_at).toLocaleString() : '-';
        document.getElementById('detail-updated').textContent = user.updated_at ? new Date(user.updated_at).toLocaleString() : '-';

        // Populate KYC tab
        const kyc = user.kyc || {};

        // Account actions (moved here from the list rows)
        renderUserDetailActions(user, kyc);

        // KYC status badge
        let kycStatusClass = 'badge-pending';
        if (kyc.kyc_status === 'approved') kycStatusClass = 'badge-approved';
        else if (kyc.kyc_status === 'rejected') kycStatusClass = 'badge-rejected';

        document.getElementById('kyc-status-badge').className = `badge ${kycStatusClass}`;
        document.getElementById('kyc-status-badge').textContent = kyc.kyc_status ? kyc.kyc_status.replace('_', ' ').toUpperCase() : 'NOT SUBMITTED';
        document.getElementById('kyc-submitted-at').textContent = kyc.kyc_submitted_at ? new Date(kyc.kyc_submitted_at).toLocaleString() : '-';

        document.getElementById('kyc-first-name').textContent = kyc.first_name || '-';
        document.getElementById('kyc-last-name').textContent = kyc.last_name || '-';
        document.getElementById('kyc-gender').textContent = kyc.gender || '-';
        document.getElementById('kyc-document-number').textContent = kyc.document_number || '-';
        document.getElementById('kyc-street').textContent = kyc.street || '-';
        document.getElementById('kyc-city').textContent = kyc.city || '-';
        document.getElementById('kyc-state').textContent = kyc.state || '-';
        document.getElementById('kyc-zip').textContent = kyc.zip_code || '-';
        document.getElementById('kyc-country').textContent = kyc.country || '-';

        // KYC document photo
        const docContainer = document.getElementById('kyc-document-container');
        const docUrl = safeUrl(kyc.document_photo);
        if (docUrl) {
            // Only http(s) or same-origin URLs reach the DOM (see safeUrl in admin-html.js)
            const link = userEl('a', { href: docUrl, target: '_blank', rel: 'noopener noreferrer', style: 'display: inline-block; position: relative;' },
                userEl('img', { src: docUrl, alt: 'KYC Document', style: 'max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); cursor: pointer;' }),
                userEl('div', { style: 'position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px;' },
                    userEl('i', { className: 'fas fa-external-link-alt', 'aria-hidden': 'true' }), ' Open full size'));
            docContainer.replaceChildren(userEl('div', { style: 'text-align: center;' }, link,
                userEl('p', { style: 'margin-top: 12px; font-size: 13px; color: #55657A;' },
                    userEl('i', { className: 'fas fa-file-image', 'aria-hidden': 'true' }), ' Document uploaded')));
        } else if (kyc.document_photo) {
            docContainer.replaceChildren(userEl('p', { style: 'color: #55657A;' }, 'Document link is not a valid web address and cannot be displayed.'));
        } else {
            docContainer.replaceChildren(userEl('p', { style: 'color: #55657A;' }, 'No document uploaded'));
        }

        // Populate questionnaire data
        const riskLabels = { very_low: 'Very Low', low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very High' };
        const incomeLabels = { under_10k: 'Less than $10,000', '10k_50k': '$10,000 - $50,000', '50k_100k': '$50,000 - $100,000', '100k_1m': '$100,000 - $1,000,000', over_1m: 'More than $1,000,000' };
        const employmentLabels = { unemployed: 'Unemployed', self_employed: 'Self-Employed', part_time: 'Part Time', full_time: 'Full Time', retired: 'Retired' };

        document.getElementById('kyc-risk-tolerance').textContent = riskLabels[kyc.risk_tolerance] || kyc.risk_tolerance || '-';
        document.getElementById('kyc-annual-income').textContent = incomeLabels[kyc.annual_income] || kyc.annual_income || '-';
        document.getElementById('kyc-employment-status').textContent = employmentLabels[kyc.employment_status] || kyc.employment_status || '-';

        // Populate login statistics
        const stats = user.login_statistics || {};
        document.getElementById('login-stat-total').textContent = stats.successful_logins || 0;
        document.getElementById('login-stat-ips').textContent = stats.unique_ips || 0;
        document.getElementById('login-stat-devices').textContent = stats.unique_devices || 0;

        // Populate login history
        const loginHistory = user.login_history || [];
        const historyContainer = document.getElementById('login-history-container');

        if (loginHistory.length === 0) {
            historyContainer.innerHTML = '<p style="text-align: center; color: #55657A; padding: 40px;">No login history available</p>';
        } else {
            const field = (label, value) => userEl('div', {},
                userEl('strong', {}, `${label}: `), value);
            const entries = loginHistory.map(login => {
                const ok = !!login.success;
                const head = userEl('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;' },
                    userEl('div', { style: 'display: flex; align-items: center; gap: 8px;' },
                        userEl('i', { className: ok ? 'fas fa-check-circle' : 'fas fa-times-circle', style: `color: ${ok ? '#2e7d32' : '#c62828'};`, 'aria-hidden': 'true' }),
                        userEl('strong', {}, ok ? 'Successful Login' : 'Failed Login')),
                    userEl('span', { style: 'color: #55657A; font-size: 13px;' },
                        login.timestamp ? new Date(login.timestamp).toLocaleString() : '-'));
                const location = login.location ? `${login.location.city || ''}, ${login.location.country || ''}` : 'Unknown';
                const grid = userEl('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;' },
                    field('IP Address', login.ip_address || 'Unknown'),
                    field('Location', location),
                    field('Device', (login.device_info && login.device_info.device) || 'Unknown'),
                    field('Browser', (login.device_info && login.device_info.browser) || 'Unknown'),
                    (!ok && login.failure_reason)
                        ? userEl('div', { style: 'grid-column: span 2; color: #c62828;' }, userEl('strong', {}, 'Reason: '), login.failure_reason)
                        : null);
                return userEl('div', { className: `login-history-item${ok ? '' : ' failed'}` }, head, grid);
            });
            historyContainer.replaceChildren(...entries);
        }

        // Hide loading and show content
        loading.style.display = 'none';
        content.style.display = 'block';

        // Switch to overview tab by default
        switchUserTab('overview');

    } catch (error) {
        console.error('Error loading user details:', error);
        Swal.fire({ title: 'Error!', text: 'Error loading user details', icon: 'error' });
        modal.classList.remove('show');
    }
}

// Account action buttons shown in the user details modal.
// They use the same data-action hooks as the old list rows, so the existing
// delegated click handler performs them.
function renderUserDetailActions(user, kyc) {
    const bar = document.getElementById('user-details-actions');
    if (!bar) return;

    const makeButton = (cls, action, icon, label, extra = {}) => userEl('button', {
        type: 'button',
        className: `btn ${cls} btn-sm`,
        'data-action': action,
        'data-user-id': user.id,
        ...extra
    }, userEl('i', { className: `fas ${icon}`, 'aria-hidden': 'true' }), ` ${label}`);

    const buttons = [];
    buttons.push(makeButton('btn-primary', 'update-balance', 'fa-edit', 'Update balance',
        { 'data-balance': user.wallet_balance ?? 0 }));

    if (kyc.kyc_completed || kyc.address_completed || kyc.personal_info_completed) {
        buttons.push(makeButton('btn-warning', 'reject-kyc', 'fa-times-circle', 'Reject KYC'));
    }

    buttons.push(user.access_granted
        ? makeButton('btn-danger', 'revoke-access', 'fa-lock', 'Revoke access')
        : makeButton('btn-success', 'grant-access', 'fa-unlock', 'Grant access'));

    buttons.push(user.is_active
        ? makeButton('btn-danger', 'deactivate-user', 'fa-ban', 'Deactivate')
        : makeButton('btn-success', 'activate-user', 'fa-check', 'Activate'));

    bar.replaceChildren(...buttons);
}

// Close user details modal
function closeUserDetailsModal() {
    const modal = document.getElementById('user-details-modal');
    modal.classList.remove('show');
}

// Show update balance modal
function showUpdateBalanceModal(userId, currentBalance) {
    document.getElementById('update-balance-user-id').value = userId;
    document.getElementById('current-balance-display').textContent =
        `$${currentBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('new-balance-input').value = currentBalance.toFixed(2);
    document.getElementById('update-balance-modal').classList.add('show');
}

// Close update balance modal
function closeUpdateBalanceModal() {
    document.getElementById('update-balance-modal').classList.remove('show');
    document.getElementById('update-balance-form').reset();
}

// Submit balance update
async function submitBalanceUpdate(event) {
    event.preventDefault();

    const userId = document.getElementById('update-balance-user-id').value;
    const newBalance = parseFloat(document.getElementById('new-balance-input').value);
    const reflectOnPortfolio = document.getElementById('reflect-on-portfolio').checked;

    try {
        const response = await adminFetch(`/api/admin/users/${userId}/update-balance`, {
            method: 'PUT',
            body: JSON.stringify({ 
                new_balance: newBalance,
                reflect_on_portfolio: reflectOnPortfolio
            })
        });

        if (response.ok) {
            const result = await response.json();
            let message = `Balance updated from $${result.old_balance.toFixed(2)} to $${result.new_balance.toFixed(2)}`;
            if (result.portfolio_updated) {
                message += '\n\nPortfolio performance has been updated.';
            }
            Swal.fire({
                title: 'Success!',
                text: message,
                icon: 'success'
            });
            closeUpdateBalanceModal();
            onUserChanged(userId); // Reload user list and open details to show updated balance
        } else {
            const error = await response.json();
            Swal.fire({
                title: 'Error!',
                text: error.detail || 'Failed to update balance',
                icon: 'error'
            });
        }
    } catch (error) {
        console.error('Error updating balance:', error);
        Swal.fire({
            title: 'Error!',
            text: 'Network error. Please try again.',
            icon: 'error'
        });
    }
}

// Switch user detail tabs
function switchUserTab(tabName) {
    // Remove active class from all buttons
    document.querySelectorAll('.user-tab-btn').forEach(btn => btn.classList.remove('active'));

    // Add active class to selected button
    const selectedBtn = document.querySelector(`.user-tab-btn[data-tab="${tabName}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }

    // Hide all tab contents
    document.querySelectorAll('.user-tab-content').forEach(content => content.classList.remove('active'));

    // Show selected tab content
    const selectedTab = document.getElementById(`user-tab-${tabName}`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
}

// Activate user
async function activateUser(userId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Activate this user?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Activating user...');
        await adminFetch(`/api/admin/users/${userId}/activate`, { method: 'PUT' });
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Success!', text: 'User activated', icon: 'success' });
        onUserChanged(userId);
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Error activating user', icon: 'error' });
    }
}

// Deactivate user
async function deactivateUser(userId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Deactivate this user?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Deactivating user...');
        await adminFetch(`/api/admin/users/${userId}/deactivate`, { method: 'PUT' });
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Success!', text: 'User deactivated', icon: 'success' });
        onUserChanged(userId);
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Error deactivating user', icon: 'error' });
    }
}

// Grant dashboard access to user
async function grantAccess(userId) {
    if (!(await Swal.fire({
                title: 'Grant Dashboard Access',
                text: 'Allow this user to access dashboard features?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, Grant Access',
                cancelButtonText: 'Cancel'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Granting access...');
        await adminFetch(`/api/admin/users/${userId}/grant-access`, { method: 'PUT' });
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Success!', text: 'Dashboard access granted to user', icon: 'success' });
        onUserChanged(userId);
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Error granting access', icon: 'error' });
    }
}

// Revoke dashboard access from user
async function revokeAccess(userId) {
    if (!(await Swal.fire({
                title: 'Revoke Dashboard Access',
                text: 'Remove dashboard access from this user?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, Revoke Access',
                cancelButtonText: 'Cancel'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Revoking access...');
        await adminFetch(`/api/admin/users/${userId}/revoke-access`, { method: 'PUT' });
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Success!', text: 'Dashboard access revoked from user', icon: 'success' });
        onUserChanged(userId);
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Error revoking access', icon: 'error' });
    }
}

// Reject KYC
async function rejectKYC(userId) {
    const result = await Swal.fire({
        title: 'Reject KYC?',
        html: `
            <p style="color: #666; margin-bottom: 15px;">This will delete all KYC/onboarding information for this user, including:</p>
            <ul style="text-align: left; color: #666; margin: 10px 0; padding-left: 30px;">
                <li>Personal information (name, gender)</li>
                <li>Address details (street, city, state, zip, country)</li>
                <li>Verification document photo</li>
                <li>Document number</li>
            </ul>
            <p style="color: #d32f2f; font-weight: 600; margin-top: 15px;">The user will be required to complete KYC/onboarding again.</p>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d32f2f',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, Reject KYC',
        cancelButtonText: 'Cancel'
    });

    if (!result.isConfirmed) return;

    try {
        TED_AUTH.showLoading('Rejecting KYC...');
        await adminFetch(`/api/admin/users/${userId}/reject-kyc`, { method: 'PUT' });
        TED_AUTH.closeLoading();
        Swal.fire({
            title: 'Success!',
            text: 'KYC rejected successfully. User will need to complete onboarding again.',
            icon: 'success'
        });
        onUserChanged(userId);
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({
            title: 'Error!',
            text: error.message || 'Error rejecting KYC',
            icon: 'error'
        });
    }
}

// ---- Trader profile photo: local file -> POST /api/admin/traders/photo -> profile_photo URL ----
const TRADER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const TRADER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const traderPhotoPreviewUrls = {};

function setTraderPhotoError(prefix, message) {
    const el = document.getElementById(`${prefix}-profile-photo-error`);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

function showTraderPhotoPreview(prefix, src) {
    const img = document.getElementById(`${prefix}-profile-photo-preview`);
    if (!img) return;
    if (src) {
        const safe = safeUrl(src);
        if (!safe) { img.removeAttribute('src'); img.hidden = true; return; }
        img.src = safe;
        img.hidden = false;
    } else {
        img.removeAttribute('src');
        img.hidden = true;
    }
}

function resetTraderPhotoPicker(prefix) {
    const input = document.getElementById(`${prefix}-profile-photo-file`);
    if (input) input.value = '';
    const hidden = document.getElementById(`${prefix}-profile-photo`);
    if (hidden) hidden.value = '';
    if (traderPhotoPreviewUrls[prefix]) {
        URL.revokeObjectURL(traderPhotoPreviewUrls[prefix]);
        traderPhotoPreviewUrls[prefix] = null;
    }
    showTraderPhotoPreview(prefix, '');
    setTraderPhotoError(prefix, '');
}

// Wire the file input once per modal; choosing a file validates it and shows a local preview.
function setupTraderPhotoPicker(prefix) {
    const input = document.getElementById(`${prefix}-profile-photo-file`);
    if (!input || input.dataset.pickerReady) return;
    input.dataset.pickerReady = 'true';
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        setTraderPhotoError(prefix, '');
        if (traderPhotoPreviewUrls[prefix]) {
            URL.revokeObjectURL(traderPhotoPreviewUrls[prefix]);
            traderPhotoPreviewUrls[prefix] = null;
        }
        if (!file) {
            showTraderPhotoPreview(prefix, document.getElementById(`${prefix}-profile-photo`).value);
            return;
        }
        if (!TRADER_PHOTO_TYPES.includes(file.type)) {
            input.value = '';
            setTraderPhotoError(prefix, 'Choose a JPEG, PNG or WebP image.');
            return;
        }
        if (file.size > TRADER_PHOTO_MAX_BYTES) {
            input.value = '';
            setTraderPhotoError(prefix, 'The photo must be 5 MB or smaller.');
            return;
        }
        traderPhotoPreviewUrls[prefix] = URL.createObjectURL(file);
        showTraderPhotoPreview(prefix, traderPhotoPreviewUrls[prefix]);
    });
}

/**
 * Resolve the photo URL for a trader form. Uploads the chosen file when there is one.
 * Returns the URL to store, the existing URL when no new file was chosen, or null on failure
 * (the error is shown in the form and the trader is not saved).
 */
async function resolveTraderPhoto(prefix) {
    const input = document.getElementById(`${prefix}-profile-photo-file`);
    const file = input && input.files && input.files[0];
    const existing = document.getElementById(`${prefix}-profile-photo`).value;
    if (!file) return existing || '';

    const body = new FormData();
    body.append('file', file);
    try {
        const response = await fetch(API_BASE + '/api/admin/traders/photo', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
            body
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setTraderPhotoError(prefix, data.detail || 'The photo could not be uploaded.');
            return null;
        }
        document.getElementById(`${prefix}-profile-photo`).value = data.url;
        return data.url;
    } catch (error) {
        console.error('Photo upload failed:', error);
        setTraderPhotoError(prefix, 'Network error while uploading the photo.');
        return null;
    }
}

// Load traders
async function loadTraders() {
    const container = document.getElementById('traders-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/traders');
        const traders = await response.json();

        if (traders.length === 0) {
            container.innerHTML = '<p>No traders found. <button class="btn btn-primary" data-action="show-add-trader-modal">Add First Trader</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        traders.forEach(trader => {
            html += `
                <div data-trader-card="${esc(trader.id)}" style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${esc(trader.full_name)}</h4>
                    <p>${esc(trader.description)}</p>
                    <p><strong>Specialization:</strong> ${esc(trader.specialization)}</p>
                    <p><strong>YTD Return:</strong> ${esc(trader.ytd_return)}% | <strong>Win Rate:</strong> ${esc(trader.win_rate)}%</p>
                    <p><strong>Copiers:</strong> ${esc(trader.copiers || 0)}</p>
                    <p><strong>Minimum Copy Amount:</strong> $${(trader.minimum_copy_amount || 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                    <p><strong>Assets Under Management:</strong> $${(trader.assets_under_management || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} | <strong>Max Drawdown:</strong> ${esc(trader.max_drawdown || 0)}% | <strong>Risk Score:</strong> ${esc(trader.risk_score || 5)}/10</p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" data-action="edit-trader" data-trader-id="${esc(trader.id)}">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" data-action="delete-trader" data-trader-id="${esc(trader.id)}">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
        // Photos are set as DOM properties, never interpolated into the markup above.
        traders.forEach(trader => {
            if (!trader.profile_photo) return;
            const card = container.querySelector(`[data-trader-card="${CSS.escape(String(trader.id))}"]`);
            if (!card) return;
            const img = document.createElement('img');
            const photo = safeUrl(trader.profile_photo);
            if (!photo) return;
            img.src = photo;
            img.alt = '';
            img.width = 64;
            img.height = 64;
            img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:50%;margin-bottom:12px;';
            card.prepend(img);
        });
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading traders</p>';
    }
}

// Show add trader modal
function showAddTraderModal() {
    const modal = document.getElementById('addTraderModal');
    modal.classList.add('show');
    setupTraderPhotoPicker('trader');

    // Setup form submission if not already done
    const form = document.getElementById('add-trader-form');
    if (!form.dataset.listenerAdded) {
        form.addEventListener('submit', handleAddTraderSubmit);
        form.dataset.listenerAdded = 'true';
    }
}

// Close add trader modal
function closeAddTraderModal() {
    const modal = document.getElementById('addTraderModal');
    modal.classList.remove('show');
    document.getElementById('add-trader-form').reset();
    resetTraderPhotoPicker('trader');
}

// Handle add trader form submission
async function handleAddTraderSubmit(e) {
    e.preventDefault();

    const photo = await resolveTraderPhoto('trader');
    if (photo === null) return;   // upload failed; the error is shown in the form
    if (!photo) {
        setTraderPhotoError('trader', 'Choose a profile photo.');
        return;
    }

    const formData = {
        full_name: document.getElementById('trader-full-name').value,
        profile_photo: photo,
        description: document.getElementById('trader-description').value,
        specialization: document.getElementById('trader-specialization').value,
        ytd_return: parseFloat(document.getElementById('trader-ytd-return').value),
        win_rate: parseFloat(document.getElementById('trader-win-rate').value),
        copiers: parseInt(document.getElementById('trader-copiers').value) || 0,
        minimum_copy_amount: parseFloat(document.getElementById('trader-minimum-amount').value) || 100,
        assets_under_management: parseFloat(document.getElementById('trader-aum').value) || 0,
        max_drawdown: parseFloat(document.getElementById('trader-max-drawdown').value) || 0,
        risk_score: parseInt(document.getElementById('trader-risk-score').value) || 5
    };

    try {
        const response = await adminFetch('/api/admin/traders', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Trader added successfully!', icon: 'success' });
            closeAddTraderModal();
            loadTraders(); // Reload traders list
        } else {
            const error = await response.json();
            alert('Error adding trader: ' + (error.detail || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error adding trader:', error);
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
    }
}

// Success/error notice with a plain alert fallback when SweetAlert is unavailable.
function notifyTrader(icon, title, text) {
    if (window.Swal) return Swal.fire({ title, text, icon });
    alert(text);
    return null;
}

// Fills the five performance fields from an API trader (effective values, as the server returns them).
// "Use live figures" is shown only when the trader has a stats override.
function fillTraderStats(trader) {
    document.getElementById('edit-trader-ytd-return').value = trader.ytd_return ?? '';
    document.getElementById('edit-trader-win-rate').value = trader.win_rate ?? '';
    document.getElementById('edit-trader-copiers').value = trader.copiers || 0;
    document.getElementById('edit-trader-aum').value = trader.assets_under_management || 0;
    document.getElementById('edit-trader-max-drawdown').value = trader.max_drawdown || 0;
    document.getElementById('edit-trader-use-live').hidden = !trader.stats_override;
}

// Clears the stats override so the trader shows live figures again.
async function useLiveTraderFigures() {
    const traderId = document.getElementById('edit-trader-id').value;
    if (!traderId) return;
    const question = 'Replace the saved performance figures with the live figures? '
        + 'The saved YTD return, win rate, copiers, AUM and max drawdown will be cleared.';
    if (window.Swal) {
        const choice = await Swal.fire({
            title: 'Use live figures', text: question, icon: 'question',
            showCancelButton: true, confirmButtonText: 'Use live figures', cancelButtonText: 'Cancel'
        });
        if (!choice.isConfirmed) return;
    } else if (!confirm(question)) {
        return;
    }
    try {
        const response = await adminFetch(`/api/admin/traders/${encodeURIComponent(traderId)}/stats-override`, {
            method: 'DELETE'
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            notifyTrader('error', 'Error!', `Error: ${(data && data.detail) || 'Failed to clear the figures'}`);
            return;
        }
        if (data) fillTraderStats(data);
        notifyTrader('success', 'Success!', 'Live figures restored.');
        loadTraders();
    } catch (error) {
        console.error(error);
        notifyTrader('error', 'Error!', 'Network error. Please try again.');
    }
}

// Show edit trader modal
async function showEditTraderModal(traderId) {
    try {
        // Fetch trader details
        const response = await adminFetch(`/api/admin/traders/${traderId}`);
        const trader = await response.json();

        // Populate form fields
        document.getElementById('edit-trader-id').value = trader.id;
        document.getElementById('edit-trader-full-name').value = trader.full_name;
        resetTraderPhotoPicker('edit-trader');
        document.getElementById('edit-trader-profile-photo').value = trader.profile_photo || '';
        showTraderPhotoPreview('edit-trader', trader.profile_photo || '');
        document.getElementById('edit-trader-description').value = trader.description;
        document.getElementById('edit-trader-specialization').value = trader.specialization;
        fillTraderStats(trader);
        document.getElementById('edit-trader-minimum-amount').value = trader.minimum_copy_amount || 100;
        document.getElementById('edit-trader-risk-score').value = trader.risk_score || 5;

        // Show modal
        setupTraderPhotoPicker('edit-trader');
        const modal = document.getElementById('edit-trader-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading trader details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit trader modal
function hideEditTraderModal() {
    const modal = document.getElementById('edit-trader-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-trader-form').reset();
        resetTraderPhotoPicker('edit-trader');
    }
}

// Submit edited trader
async function submitEditedTrader(event) {
    event.preventDefault();

    const traderId = document.getElementById('edit-trader-id').value;
    const photo = await resolveTraderPhoto('edit-trader');
    if (photo === null) return;   // upload failed; the error is shown in the form

    const traderData = {
        full_name: document.getElementById('edit-trader-full-name').value,
        profile_photo: photo,
        description: document.getElementById('edit-trader-description').value,
        specialization: document.getElementById('edit-trader-specialization').value,
        ytd_return: parseFloat(document.getElementById('edit-trader-ytd-return').value),
        win_rate: parseFloat(document.getElementById('edit-trader-win-rate').value),
        copiers: parseInt(document.getElementById('edit-trader-copiers').value) || 0,
        minimum_copy_amount: parseFloat(document.getElementById('edit-trader-minimum-amount').value) || 100,
        assets_under_management: parseFloat(document.getElementById('edit-trader-aum').value) || 0,
        max_drawdown: parseFloat(document.getElementById('edit-trader-max-drawdown').value) || 0,
        risk_score: parseInt(document.getElementById('edit-trader-risk-score').value) || 5
    };

    try {
        const response = await adminFetch(`/api/admin/traders/${traderId}`, {
            method: 'PUT',
            body: JSON.stringify(traderData)
        });

        if (response.ok) {
            // Show the effective values the server stored, not the typed ones. The modal stays open so they are visible.
            const updated = await response.json().catch(() => null);
            if (updated) fillTraderStats(updated);
            notifyTrader('success', 'Success!', 'Trader updated successfully!');
            loadTraders();
        } else {
            const error = await response.json().catch(() => ({}));
            notifyTrader('error', 'Error!', `Error: ${formatApiDetail(error.detail, 'Failed to update trader')}`);
        }
    } catch (error) {
        notifyTrader('error', 'Error!', 'Network error. Please try again.');
        console.error(error);
    }
}

// FastAPI returns validation errors as an array of objects; show their messages, never "[object Object]".
function formatApiDetail(detail, fallback) {
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
        const msgs = detail.map((d) => (d && d.msg) || '').filter(Boolean);
        if (msgs.length) return msgs.join('; ');
    }
    return fallback;
}

// Delete trader
async function deleteTrader(traderId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to delete this trader? This action cannot be undone.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/traders/${traderId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Trader deleted successfully', icon: 'success' });
            loadTraders();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete trader'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Load plans
async function loadPlans() {
    const container = document.getElementById('plans-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/plans');
        const plans = await response.json();

        if (plans.length === 0) {
            container.innerHTML = '<p>No plans found. <button class="btn btn-primary" data-action="show-add-plan-modal">Add First Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${esc(plan.name || 'Unnamed Plan')}</h4>
                    <p>${esc(plan.description || '')}</p>
                    <p><strong>Min Investment:</strong> $${(plan.minimum_investment || 0).toLocaleString()}</p>
                    <p><strong>Return:</strong> ${esc(plan.expected_return_percent ?? 'N/A')}% | <strong>Period:</strong> ${esc(plan.holding_period_months ?? 'N/A')} months</p>
                    <p><strong>Subscribers:</strong> ${esc(plan.current_subscribers || 0)}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" data-action="edit-plan" data-plan-id="${esc(plan.id)}">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" data-action="delete-plan" data-plan-id="${esc(plan.id)}">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading plans</p>';
    }
}

// Show add plan modal
function showAddPlanModal() {
    const modal = document.getElementById('add-plan-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add plan modal
function hideAddPlanModal() {
    const modal = document.getElementById('add-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-plan-form').reset();
    }
}

// Submit new plan
async function submitNewPlan(event) {
    event.preventDefault();

    const planData = {
        name: document.getElementById('plan-name').value,
        description: document.getElementById('plan-description').value,
        minimum_investment: parseFloat(document.getElementById('plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('plan-return').value),
        holding_period_months: parseInt(document.getElementById('plan-period').value),
        current_subscribers: parseInt(document.getElementById('plan-subscribers').value) || 0,
        is_active: document.getElementById('plan-active').checked,
        tags: Array.from(document.getElementById('plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch('/api/admin/plans', {
            method: 'POST',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Investment plan created successfully!', icon: 'success' });
            hideAddPlanModal();
            loadPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to create plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
    }
}

// Show edit plan modal
async function showEditPlanModal(planId) {
    try {
        // Fetch plan details
        const response = await adminFetch(`/api/admin/plans/${planId}`);
        const plan = await response.json();

        // Populate form fields
        document.getElementById('edit-plan-id').value = plan.id;
        document.getElementById('edit-plan-name').value = plan.name;
        document.getElementById('edit-plan-description').value = plan.description;
        document.getElementById('edit-plan-min-investment').value = plan.minimum_investment;
        document.getElementById('edit-plan-return').value = plan.expected_return_percent;
        document.getElementById('edit-plan-period').value = plan.holding_period_months;
        document.getElementById('edit-plan-active').checked = plan.is_active;
        document.getElementById('edit-plan-subscribers').value = plan.current_subscribers || 0;
        
        // Populate tags
        const editTagsSelect = document.getElementById('edit-plan-tags');
        if (editTagsSelect && plan.tags) {
            plan.tags.forEach(tag => {
                const option = editTagsSelect.querySelector(`option[value="${tag}"]`);
                if (option) option.selected = true;
            });
        }

        // Show modal
        const modal = document.getElementById('edit-plan-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading plan details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit plan modal
function hideEditPlanModal() {
    const modal = document.getElementById('edit-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-plan-form').reset();
    }
}

// Submit edited plan
async function submitEditedPlan(event) {
    event.preventDefault();

    const planId = document.getElementById('edit-plan-id').value;
    const planData = {
        name: document.getElementById('edit-plan-name').value,
        description: document.getElementById('edit-plan-description').value,
        minimum_investment: parseFloat(document.getElementById('edit-plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('edit-plan-return').value),
        holding_period_months: parseInt(document.getElementById('edit-plan-period').value),
        current_subscribers: parseInt(document.getElementById('edit-plan-subscribers').value) || 0,
        is_active: document.getElementById('edit-plan-active').checked,
        tags: Array.from(document.getElementById('edit-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch(`/api/admin/plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Investment plan updated successfully!', icon: 'success' });
            hideEditPlanModal();
            loadPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete plan
async function deletePlan(planId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to delete this investment plan? This action cannot be undone.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/plans/${planId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Investment plan deleted successfully', icon: 'success' });
            loadPlans();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete plan'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// ETF PLANS
// ============================================================

// Load ETF plans
async function loadETFPlans() {
    const container = document.getElementById('etf-plans-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/etf-plans');
        const plans = await response.json();

        if (plans.length === 0) {
            container.innerHTML = '<p>No ETF plans found. <button class="btn btn-primary" data-action="show-add-etf-plan-modal">Add First ETF Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${esc(plan.name || 'Unnamed Plan')}</h4>
                    <p><strong>Type:</strong> ${esc(plan.plan_type || 'N/A')}</p>
                    ${plan.description ? `<p>${esc(plan.description)}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${esc(plan.expected_return_percent ?? 'N/A')}% | <strong>Duration:</strong> ${esc(plan.duration_months ?? 'N/A')} months</p>
                    <p><strong>Min Investment:</strong> $${(plan.minimum_investment || 0).toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" data-action="edit-etf-plan" data-plan-id="${esc(plan.id)}">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" data-action="delete-etf-plan" data-plan-id="${esc(plan.id)}">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading ETF plans</p>';
        console.error(error);
    }
}

// Show add ETF plan modal
function showAddETFPlanModal() {
    const modal = document.getElementById('add-etf-plan-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add ETF plan modal
function hideAddETFPlanModal() {
    const modal = document.getElementById('add-etf-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-etf-plan-form').reset();
    }
}

// Submit new ETF plan
async function submitNewETFPlan(event) {
    event.preventDefault();

    const planData = {
        name: document.getElementById('etf-plan-name').value,
        plan_type: document.getElementById('etf-plan-type').value,
        expected_return_percent: parseFloat(document.getElementById('etf-plan-return').value),
        duration_months: parseInt(document.getElementById('etf-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('etf-plan-min-investment').value),
        description: document.getElementById('etf-plan-description').value || null,
        is_active: document.getElementById('etf-plan-active').checked,
        tags: Array.from(document.getElementById('etf-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch('/api/admin/etf-plans', {
            method: 'POST',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'ETF plan created successfully!', icon: 'success' });
            hideAddETFPlanModal();
            loadETFPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to create ETF plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Show edit ETF plan modal
async function showEditETFPlanModal(planId) {
    try {
        // Fetch ETF plan details
        const response = await adminFetch(`/api/admin/etf-plans/${planId}`);
        const plan = await response.json();

        // Populate form fields
        document.getElementById('edit-etf-plan-id').value = plan.id;
        document.getElementById('edit-etf-plan-name').value = plan.name;
        document.getElementById('edit-etf-plan-type').value = plan.plan_type;
        document.getElementById('edit-etf-plan-return').value = plan.expected_return_percent;
        document.getElementById('edit-etf-plan-duration').value = plan.duration_months;
        document.getElementById('edit-etf-plan-min-investment').value = plan.minimum_investment;
        document.getElementById('edit-etf-plan-description').value = plan.description || '';
        document.getElementById('edit-etf-plan-active').checked = plan.is_active;
        
        // Populate tags
        const editTagsSelect = document.getElementById('edit-etf-plan-tags');
        if (editTagsSelect && plan.tags) {
            plan.tags.forEach(tag => {
                const option = editTagsSelect.querySelector(`option[value="${tag}"]`);
                if (option) option.selected = true;
            });
        }

        // Show modal
        const modal = document.getElementById('edit-etf-plan-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading ETF plan details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit ETF plan modal
function hideEditETFPlanModal() {
    const modal = document.getElementById('edit-etf-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-etf-plan-form').reset();
    }
}

// Submit edited ETF plan
async function submitEditedETFPlan(event) {
    event.preventDefault();

    const planId = document.getElementById('edit-etf-plan-id').value;
    const planData = {
        name: document.getElementById('edit-etf-plan-name').value,
        plan_type: document.getElementById('edit-etf-plan-type').value,
        expected_return_percent: parseFloat(document.getElementById('edit-etf-plan-return').value),
        duration_months: parseInt(document.getElementById('edit-etf-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('edit-etf-plan-min-investment').value),
        description: document.getElementById('edit-etf-plan-description').value || null,
        is_active: document.getElementById('edit-etf-plan-active').checked,
        tags: Array.from(document.getElementById('edit-etf-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch(`/api/admin/etf-plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'ETF plan updated successfully!', icon: 'success' });
            hideEditETFPlanModal();
            loadETFPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update ETF plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete ETF plan
async function deleteETFPlan(planId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to delete this ETF plan? This action cannot be undone.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/etf-plans/${planId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'ETF plan deleted successfully', icon: 'success' });
            loadETFPlans();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete ETF plan'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// DeFi Plans Management
async function loadDeFiPlans() {
    const container = document.getElementById('defi-plans-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/defi-plans');
        const plans = await response.json();

        if (plans.length === 0) {
            container.innerHTML = '<p>No DeFi plans found. <button class="btn btn-primary" data-action="show-add-defi-plan-modal">Add First DeFi Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${esc(plan.name || 'Unnamed Plan')}</h4>
                    <p><strong>Portfolio Type:</strong> ${esc(plan.portfolio_type || 'N/A')}</p>
                    ${plan.description ? `<p>${esc(plan.description)}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${esc(plan.expected_return_percent ?? 'N/A')}% | <strong>Duration:</strong> ${esc(plan.duration_months ?? 'N/A')} months</p>
                    <p><strong>Min Investment:</strong> $${(plan.minimum_investment || 0).toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" data-action="edit-defi-plan" data-plan-id="${esc(plan.id)}">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" data-action="delete-defi-plan" data-plan-id="${esc(plan.id)}">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading DeFi plans</p>';
        console.error(error);
    }
}

// Show add DeFi plan modal
function showAddDeFiPlanModal() {
    const modal = document.getElementById('add-defi-plan-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add DeFi plan modal
function hideAddDeFiPlanModal() {
    const modal = document.getElementById('add-defi-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-defi-plan-form').reset();
    }
}

// Submit new DeFi plan
async function submitNewDeFiPlan(event) {
    event.preventDefault();

    const planData = {
        name: document.getElementById('defi-plan-name').value,
        portfolio_type: document.getElementById('defi-plan-portfolio-type').value,
        expected_return_percent: parseFloat(document.getElementById('defi-plan-return').value),
        duration_months: parseInt(document.getElementById('defi-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('defi-plan-min-investment').value),
        description: document.getElementById('defi-plan-description').value || null,
        is_active: document.getElementById('defi-plan-active').checked,
        tags: Array.from(document.getElementById('defi-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch('/api/admin/defi-plans', {
            method: 'POST',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'DeFi plan created successfully!', icon: 'success' });
            hideAddDeFiPlanModal();
            loadDeFiPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to create DeFi plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Show edit DeFi plan modal
async function showEditDeFiPlanModal(planId) {
    try {
        // Fetch DeFi plan details
        const response = await adminFetch(`/api/admin/defi-plans/${planId}`);
        const plan = await response.json();

        // Populate form fields
        document.getElementById('edit-defi-plan-id').value = plan.id;
        document.getElementById('edit-defi-plan-name').value = plan.name;
        document.getElementById('edit-defi-plan-portfolio-type').value = plan.portfolio_type;
        document.getElementById('edit-defi-plan-return').value = plan.expected_return_percent;
        document.getElementById('edit-defi-plan-duration').value = plan.duration_months;
        document.getElementById('edit-defi-plan-min-investment').value = plan.minimum_investment;
        document.getElementById('edit-defi-plan-description').value = plan.description || '';
        document.getElementById('edit-defi-plan-active').checked = plan.is_active;
        
        // Populate tags
        const editTagsSelect = document.getElementById('edit-defi-plan-tags');
        if (editTagsSelect && plan.tags) {
            plan.tags.forEach(tag => {
                const option = editTagsSelect.querySelector(`option[value="${tag}"]`);
                if (option) option.selected = true;
            });
        }

        // Show modal
        const modal = document.getElementById('edit-defi-plan-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading DeFi plan details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit DeFi plan modal
function hideEditDeFiPlanModal() {
    const modal = document.getElementById('edit-defi-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-defi-plan-form').reset();
    }
}

// Submit edited DeFi plan
async function submitEditedDeFiPlan(event) {
    event.preventDefault();

    const planId = document.getElementById('edit-defi-plan-id').value;
    const planData = {
        name: document.getElementById('edit-defi-plan-name').value,
        portfolio_type: document.getElementById('edit-defi-plan-portfolio-type').value,
        expected_return_percent: parseFloat(document.getElementById('edit-defi-plan-return').value),
        duration_months: parseInt(document.getElementById('edit-defi-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('edit-defi-plan-min-investment').value),
        description: document.getElementById('edit-defi-plan-description').value || null,
        is_active: document.getElementById('edit-defi-plan-active').checked,
        tags: Array.from(document.getElementById('edit-defi-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch(`/api/admin/defi-plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'DeFi plan updated successfully!', icon: 'success' });
            hideEditDeFiPlanModal();
            loadDeFiPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update DeFi plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete DeFi plan
async function deleteDeFiPlan(planId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to delete this DeFi plan? This action cannot be undone.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/defi-plans/${planId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'DeFi plan deleted successfully', icon: 'success' });
            loadDeFiPlans();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete DeFi plan'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Options Plans Management
async function loadOptionsPlans() {
    const container = document.getElementById('options-plans-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/options-plans');
        const plans = await response.json();

        if (plans.length === 0) {
            container.innerHTML = '<p>No Options plans found. <button class="btn btn-primary" data-action="show-add-options-plan-modal">Add First Options Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${esc(plan.name || 'Unnamed Plan')}</h4>
                    <p><strong>Plan Type:</strong> ${esc(plan.plan_type || 'N/A')}</p>
                    ${plan.description ? `<p>${esc(plan.description)}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${esc(plan.expected_return_percent ?? 'N/A')}% | <strong>Duration:</strong> ${esc(plan.duration_months > 0 ? plan.duration_months + ' months' : 'Ongoing')}</p>
                    <p><strong>Min Investment:</strong> $${(plan.minimum_investment || 0).toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" data-action="edit-options-plan" data-plan-id="${esc(plan.id)}">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" data-action="delete-options-plan" data-plan-id="${esc(plan.id)}">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading Options plans</p>';
        console.error(error);
    }
}

// Show add Options plan modal
function showAddOptionsPlanModal() {
    const modal = document.getElementById('add-options-plan-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add Options plan modal
function hideAddOptionsPlanModal() {
    const modal = document.getElementById('add-options-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-options-plan-form').reset();
    }
}

// Submit new Options plan
async function submitNewOptionsPlan(event) {
    event.preventDefault();

    const planData = {
        name: document.getElementById('options-plan-name').value,
        plan_type: document.getElementById('options-plan-type').value,
        expected_return_percent: parseFloat(document.getElementById('options-plan-return').value),
        duration_months: parseInt(document.getElementById('options-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('options-plan-min-investment').value),
        description: document.getElementById('options-plan-description').value || null,
        is_active: document.getElementById('options-plan-active').checked,
        tags: Array.from(document.getElementById('options-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch('/api/admin/options-plans', {
            method: 'POST',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Options plan created successfully!', icon: 'success' });
            hideAddOptionsPlanModal();
            loadOptionsPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to create Options plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Show edit Options plan modal
async function showEditOptionsPlanModal(planId) {
    try {
        // Fetch Options plan details
        const response = await adminFetch(`/api/admin/options-plans/${planId}`);
        const plan = await response.json();

        // Populate form fields
        document.getElementById('edit-options-plan-id').value = plan.id;
        document.getElementById('edit-options-plan-name').value = plan.name;
        document.getElementById('edit-options-plan-type').value = plan.plan_type;
        document.getElementById('edit-options-plan-return').value = plan.expected_return_percent;
        document.getElementById('edit-options-plan-duration').value = plan.duration_months;
        document.getElementById('edit-options-plan-min-investment').value = plan.minimum_investment;
        document.getElementById('edit-options-plan-description').value = plan.description || '';
        document.getElementById('edit-options-plan-active').checked = plan.is_active;
        
        // Populate tags
        const editTagsSelect = document.getElementById('edit-options-plan-tags');
        if (editTagsSelect && plan.tags) {
            plan.tags.forEach(tag => {
                const option = editTagsSelect.querySelector(`option[value="${tag}"]`);
                if (option) option.selected = true;
            });
        }

        // Show modal
        const modal = document.getElementById('edit-options-plan-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading Options plan details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit Options plan modal
function hideEditOptionsPlanModal() {
    const modal = document.getElementById('edit-options-plan-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-options-plan-form').reset();
    }
}

// Submit edited Options plan
async function submitEditedOptionsPlan(event) {
    event.preventDefault();

    const planId = document.getElementById('edit-options-plan-id').value;
    const planData = {
        name: document.getElementById('edit-options-plan-name').value,
        plan_type: document.getElementById('edit-options-plan-type').value,
        expected_return_percent: parseFloat(document.getElementById('edit-options-plan-return').value),
        duration_months: parseInt(document.getElementById('edit-options-plan-duration').value),
        minimum_investment: parseFloat(document.getElementById('edit-options-plan-min-investment').value),
        description: document.getElementById('edit-options-plan-description').value || null,
        is_active: document.getElementById('edit-options-plan-active').checked,
        tags: Array.from(document.getElementById('edit-options-plan-tags').selectedOptions).map(o => o.value)
    };

    try {
        const response = await adminFetch(`/api/admin/options-plans/${planId}`, {
            method: 'PUT',
            body: JSON.stringify(planData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Options plan updated successfully!', icon: 'success' });
            hideEditOptionsPlanModal();
            loadOptionsPlans();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update Options plan'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete Options plan
async function deleteOptionsPlan(planId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to delete this Options plan? This action cannot be undone.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/options-plans/${planId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Options plan deleted successfully', icon: 'success' });
            loadOptionsPlans();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete Options plan'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Logout
async function logout() {
    if ((await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to logout?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
        localStorage.removeItem('admin_token');
        window.location.href = '/admin/login';
    }
}

// ============================================================
// DEPOSIT REQUESTS
// ============================================================

// Load deposit requests
async function loadDepositRequests(statusFilter = '') {
    const container = document.getElementById('deposits-table-container');
    container.innerHTML = 'Loading...';

    try {
        const url = statusFilter ? `/api/admin/deposit-requests?status_filter=${statusFilter}` : '/api/admin/deposit-requests';
        const response = await adminFetch(url);
        const data = await response.json();

        if (data.requests.length === 0) {
            container.innerHTML = '<p>No deposit requests found</p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Amount</th>
                        <th>Payment Method</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.requests.forEach(req => {
            const date = new Date(req.created_at).toLocaleDateString();
            const statusBadge = `badge-${esc(req.status)}`;
            html += `
                <tr>
                    <td>${esc(req.username)}<br><small style="color: #55657A;">${esc(req.email)}</small></td>
                    <td><strong>$${req.amount.toLocaleString()}</strong></td>
                    <td>${esc(req.payment_method)}</td>
                    <td><span class="badge ${statusBadge}">${esc(req.status)}</span></td>
                    <td>${date}</td>
                    <td>
                        ${req.status === 'pending' ? `
                            <div class="action-buttons">
                                <button class="btn btn-success" style="padding: 5px 10px;" data-action="approve-deposit" data-request-id="${esc(req.id)}">Approve</button>
                                <button class="btn btn-danger" style="padding: 5px 10px;" data-action="reject-deposit" data-request-id="${esc(req.id)}">Reject</button>
                            </div>
                        ` : `<span style="color: #55657A;">Reviewed</span>`}
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading deposit requests</p>';
        console.error(error);
    }
}

// Filter deposit requests
function filterDepositRequests() {
    const statusFilter = document.getElementById('deposit-status-filter').value;
    loadDepositRequests(statusFilter);
}

// Approve deposit
async function approveDeposit(requestId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Approve this deposit request? This will credit the user wallet.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Approving deposit...');
        const response = await adminFetch(`/api/admin/deposit-requests/${requestId}/approve`, { method: 'PUT' });
        TED_AUTH.closeLoading();

        if (response.ok) {
            const data = await response.json();
            Swal.fire({ title: 'Success!', text: `Deposit approved! $${data.amount} credited to user wallet.`, icon: 'success' });
            loadDepositRequests();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: 'Error: ' + (error.detail || 'Failed to approve deposit'), icon: 'error' });
        }
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Reject deposit
async function rejectDeposit(requestId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Reject this deposit request?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        TED_AUTH.showLoading('Rejecting deposit...');
        const response = await adminFetch(`/api/admin/deposit-requests/${requestId}/reject`, { method: 'PUT' });
        TED_AUTH.closeLoading();

        if (response.ok) {
            Swal.fire({ title: 'Notice', text: 'Deposit request rejected', icon: 'info' });
            loadDepositRequests();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: 'Error: ' + (error.detail || 'Failed to reject deposit'), icon: 'error' });
        }
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// CRYPTO WALLETS
// ============================================================

// Load crypto wallets
async function loadCryptoWallets() {
    const container = document.getElementById('crypto-wallets-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/crypto-wallets');
        const wallets = await response.json();

        if (wallets.length === 0) {
            container.innerHTML = '<p>No crypto wallets found. <button class="btn btn-primary" data-action="show-add-crypto-wallet-modal">Add First Wallet</button></p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Currency</th>
                        <th>Wallet Address</th>
                        <th>Network</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        wallets.forEach(wallet => {
            const date = wallet.created_at ? new Date(wallet.created_at).toLocaleDateString() : 'N/A';
            html += `
                <tr>
                    <td><strong>${esc(wallet.currency)}</strong></td>
                    <td><code style="background: #f7fafc; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${esc(wallet.wallet_address)}</code></td>
                    <td>${esc(wallet.network || 'N/A')}</td>
                    <td><span class="badge badge-${wallet.is_active ? 'active' : 'inactive'}">${wallet.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>${date}</td>
                    <td>
                        <button class="btn btn-primary" style="padding: 5px 10px; margin-right: 5px;" data-action="edit-crypto-wallet" data-wallet-id="${esc(wallet.id)}"><i class="fas fa-edit"></i> Edit</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" data-action="delete-crypto-wallet" data-wallet-id="${esc(wallet.id)}"><i class="fas fa-trash"></i> Delete</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading crypto wallets</p>';
        console.error(error);
    }
}

// Show add crypto wallet modal
function showAddCryptoWalletModal() {
    const modal = document.getElementById('add-crypto-wallet-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add crypto wallet modal
function hideAddCryptoWalletModal() {
    const modal = document.getElementById('add-crypto-wallet-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-crypto-wallet-form').reset();
    }
}

// Submit new crypto wallet
async function submitNewCryptoWallet(event) {
    event.preventDefault();

    const walletData = {
        currency: document.getElementById('crypto-currency').value,
        wallet_address: document.getElementById('crypto-wallet-address').value,
        network: document.getElementById('crypto-network').value || null,
        is_active: document.getElementById('crypto-active').checked
    };

    try {
        const response = await adminFetch('/api/admin/crypto-wallets', {
            method: 'POST',
            body: JSON.stringify(walletData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Crypto wallet added successfully!', icon: 'success' });
            hideAddCryptoWalletModal();
            loadCryptoWallets();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to add wallet'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete crypto wallet
async function deleteCryptoWallet(walletId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Delete this crypto wallet?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/crypto-wallets/${walletId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Crypto wallet deleted successfully', icon: 'success' });
            loadCryptoWallets();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete wallet'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Show edit crypto wallet modal
async function showEditCryptoWalletModal(walletId) {
    try {
        const response = await adminFetch(`/api/admin/crypto-wallets/${walletId}`);
        const wallet = await response.json();

        // Populate form fields
        document.getElementById('edit-crypto-wallet-id').value = wallet.id;
        document.getElementById('edit-crypto-currency').value = wallet.currency;
        document.getElementById('edit-crypto-wallet-address').value = wallet.wallet_address;
        document.getElementById('edit-crypto-network').value = wallet.network || '';
        document.getElementById('edit-crypto-active').checked = wallet.is_active;

        // Show modal
        const modal = document.getElementById('edit-crypto-wallet-modal');
        if (modal) {
            modal.classList.add('show');
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Error loading wallet details', icon: 'error' });
        console.error(error);
    }
}

// Hide edit crypto wallet modal
function hideEditCryptoWalletModal() {
    const modal = document.getElementById('edit-crypto-wallet-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('edit-crypto-wallet-form').reset();
    }
}

// Submit edited crypto wallet
async function submitEditedCryptoWallet(event) {
    event.preventDefault();

    const walletId = document.getElementById('edit-crypto-wallet-id').value;
    const walletData = {
        currency: document.getElementById('edit-crypto-currency').value,
        wallet_address: document.getElementById('edit-crypto-wallet-address').value,
        network: document.getElementById('edit-crypto-network').value || null,
        is_active: document.getElementById('edit-crypto-active').checked
    };

    try {
        const response = await adminFetch(`/api/admin/crypto-wallets/${walletId}`, {
            method: 'PUT',
            body: JSON.stringify(walletData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Crypto wallet updated successfully!', icon: 'success' });
            hideEditCryptoWalletModal();
            loadCryptoWallets();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update wallet'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// BANK ACCOUNTS
// ============================================================

// Load bank accounts
async function loadBankAccounts() {
    const container = document.getElementById('bank-accounts-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/bank-accounts');
        const accounts = await response.json();

        if (accounts.length === 0) {
            container.innerHTML = '<p>No bank accounts found. <button class="btn btn-primary" data-action="show-add-bank-account-modal">Add First Account</button></p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Bank Name</th>
                        <th>Account Name</th>
                        <th>Account Number</th>
                        <th>Routing</th>
                        <th>SWIFT</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        accounts.forEach(account => {
            html += `
                <tr>
                    <td><strong>${esc(account.bank_name)}</strong></td>
                    <td>${esc(account.account_name)}</td>
                    <td><code style="background: #f7fafc; padding: 4px 8px; border-radius: 4px;">${esc(account.account_number)}</code></td>
                    <td>${esc(account.routing_number || 'N/A')}</td>
                    <td>${esc(account.swift_code || 'N/A')}</td>
                    <td><span class="badge badge-${account.is_active ? 'active' : 'inactive'}">${account.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        <button class="btn btn-danger" style="padding: 5px 10px;" data-action="delete-bank-account" data-account-id="${esc(account.id)}">Delete</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading bank accounts</p>';
        console.error(error);
    }
}

// Show add bank account modal
function showAddBankAccountModal() {
    const modal = document.getElementById('add-bank-account-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide add bank account modal
function hideAddBankAccountModal() {
    const modal = document.getElementById('add-bank-account-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('add-bank-account-form').reset();
    }
}

// Submit new bank account
async function submitNewBankAccount(event) {
    event.preventDefault();

    const accountData = {
        bank_name: document.getElementById('bank-name').value,
        account_name: document.getElementById('account-name').value,
        account_number: document.getElementById('account-number').value,
        routing_number: document.getElementById('routing-number').value || null,
        swift_code: document.getElementById('swift-code').value || null,
        is_active: document.getElementById('bank-active').checked
    };

    try {
        const response = await adminFetch('/api/admin/bank-accounts', {
            method: 'POST',
            body: JSON.stringify(accountData)
        });

        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Bank account added successfully!', icon: 'success' });
            hideAddBankAccountModal();
            loadBankAccounts();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to add account'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete bank account
async function deleteBankAccount(accountId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Delete this bank account?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/bank-accounts/${accountId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Bank account deleted successfully', icon: 'success' });
            loadBankAccounts();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete account'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

// Load notifications
async function loadNotifications() {
    const container = document.getElementById('notifications-container');
    container.innerHTML = 'Loading...';

    try {
        const response = await adminFetch('/api/admin/notifications');
        const data = await response.json();

        if (data.notifications.length === 0) {
            container.innerHTML = '<p>No notifications found. <button class="btn btn-primary" data-action="show-create-notification-modal">Create First Notification</button></p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Target</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.notifications.forEach(notif => {
            const date = new Date(notif.created_at).toLocaleDateString();
            const typeColors = {
                'info': '#2196F3',
                'success': '#4caf50',
                'warning': '#ff9800',
                'error': '#f44336'
            };
            const typeColor = typeColors[notif.notification_type] || '#55657A';

            html += `
                <tr>
                    <td><strong>${esc(notif.title)}</strong><br><small style="color: #55657A;">${esc(notif.message.substring(0, 50))}${notif.message.length > 50 ? '...' : ''}</small></td>
                    <td><span class="badge" style="background: ${typeColor};">${esc(notif.notification_type.toUpperCase())}</span></td>
                    <td>${notif.target_type === 'all' ? '<strong>All Users</strong>' : 'Specific User'}</td>
                    <td>${date}</td>
                    <td>
                        <button class="btn btn-danger" style="padding: 5px 10px;" data-action="delete-notification" data-notification-id="${esc(notif.id)}">Delete</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading notifications</p>';
        console.error(error);
    }
}

// Show create notification modal
function showCreateNotificationModal() {
    const modal = document.getElementById('create-notification-modal');
    if (modal) {
        modal.classList.add('show');
        document.getElementById('create-notification-form').reset();
        document.getElementById('user-selection-group').style.display = 'none';
        document.getElementById('notif-target-user').value = '';
        document.getElementById('user-search-results').style.display = 'none';
        document.getElementById('selected-user-display').style.display = 'none';
    }
}

// Hide create notification modal
function hideCreateNotificationModal() {
    const modal = document.getElementById('create-notification-modal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('create-notification-form').reset();
    }
}

// Toggle user selection based on target type
function toggleUserSelection() {
    const targetType = document.getElementById('notif-target-type').value;
    const userSelectionGroup = document.getElementById('user-selection-group');

    if (targetType === 'specific') {
        userSelectionGroup.style.display = 'block';
    } else {
        userSelectionGroup.style.display = 'none';
        document.getElementById('notif-target-user').value = '';
    }
}

// Search users for notification
let userSearchTimeout;
async function searchUsersForNotification() {
    clearTimeout(userSearchTimeout);
    const search = document.getElementById('notif-target-user-search').value.trim();

    if (search.length < 2) {
        document.getElementById('user-search-results').style.display = 'none';
        return;
    }

    userSearchTimeout = setTimeout(async () => {
        try {
            const response = await adminFetch(`/api/admin/users?search=${encodeURIComponent(search)}&limit=10`);
            const data = await response.json();
            const resultsDiv = document.getElementById('user-search-results');

            if (data.users.length === 0) {
                resultsDiv.innerHTML = '<p style="padding: 10px; color: #55657A;">No users found</p>';
                resultsDiv.style.display = 'block';
                return;
            }

            let html = '';
            data.users.forEach(user => {
                html += `
                    <div class="user-search-result-item" role="button" tabindex="0" data-action="select-user-notification" data-user-id="${esc(user.id)}" data-username="${esc(user.username)}" data-email="${esc(user.email)}">
                        <strong>${esc(user.username)}</strong><br>
                        <small style="color: #55657A;">${esc(user.email)}</small>
                    </div>
                `;
            });

            resultsDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }, 300);
}

// Select user for notification
function selectUserForNotification(userId, username, email) {
    document.getElementById('notif-target-user').value = userId;
    document.getElementById('user-search-results').style.display = 'none';
    document.getElementById('notif-target-user-search').value = `${username} (${email})`;
    document.getElementById('selected-user-display').textContent = `✓ Selected: ${username} (${email})`;
    document.getElementById('selected-user-display').style.display = 'block';
}

// Submit new notification
async function submitNewNotification(event) {
    event.preventDefault();

    const targetType = document.getElementById('notif-target-type').value;
    const notificationData = {
        title: document.getElementById('notif-title').value,
        message: document.getElementById('notif-message').value,
        notification_type: document.getElementById('notif-type').value,
        target_type: targetType,
        target_user_id: targetType === 'specific' ? document.getElementById('notif-target-user').value : null
    };

    // Validate specific user selection
    if (targetType === 'specific' && !notificationData.target_user_id) {
        Swal.fire({ title: 'Warning', text: 'Please select a user for specific notification', icon: 'warning' });
        return;
    }

    try {
        const response = await adminFetch('/api/admin/notifications', {
            method: 'POST',
            body: JSON.stringify(notificationData)
        });

        if (response.ok) {
            const data = await response.json();
            alert(data.message || 'Notification sent successfully!');
            hideCreateNotificationModal();
            loadNotifications();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to send notification'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Delete notification
async function deleteNotification(notificationId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Delete this notification? This will remove it for all users.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/notifications/${notificationId}`, { method: 'DELETE' });
        if (response.ok) {
            Swal.fire({ title: 'Success!', text: 'Notification deleted successfully', icon: 'success' });
            loadNotifications();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to delete notification'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// WITHDRAWAL REQUESTS
// ============================================================

// Payout accounts (user bank account and crypto wallets) awaiting admin verification.
// Rendered with DOM APIs only: customer-supplied values are set as text, never as HTML.
function payoutCell(text, extraClass = '') {
    const td = document.createElement('td');
    td.style.cssText = 'padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top;';
    if (extraClass) td.className = extraClass;
    td.textContent = text == null || text === '' ? '—' : String(text);
    return td;
}

async function loadPayoutAccounts() {
    const container = document.getElementById('payout-verify-container');
    if (!container) return;
    container.textContent = 'Loading payout accounts...';
    try {
        const [bankRes, cryptoRes] = await Promise.all([
            adminFetch('/api/admin/user-bank-accounts'),
            adminFetch('/api/admin/user-crypto-addresses')
        ]);
        if (!bankRes.ok || !cryptoRes.ok) throw new Error('Request failed');
        const banks = await bankRes.json();
        const cryptos = await cryptoRes.json();
        const rows = [
            ...banks.map((a) => ({ kind: 'Bank account', user: a.user_id, detail: `${a.bank_name} · ${a.account_name} · ${a.account_number}${a.swift_code ? ` · SWIFT ${a.swift_code}` : ''}`, verified: a.is_verified, endpoint: `/api/admin/user-bank-accounts/${a.id}/verify`, created: a.created_at })),
            ...cryptos.map((a) => ({ kind: `Crypto · ${a.currency}`, user: a.user_id, detail: `${a.wallet_address}${a.network ? ` · ${a.network}` : ''}${a.label ? ` · ${a.label}` : ''}`, verified: a.is_verified, endpoint: `/api/admin/user-crypto-addresses/${a.id}/verify`, created: a.created_at })),
        ].sort((x, y) => (x.verified === y.verified ? 0 : x.verified ? 1 : -1) || String(y.created).localeCompare(String(x.created)));

        if (rows.length === 0) {
            container.textContent = 'No payout accounts saved yet.';
            return;
        }
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 14px;';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Type', 'User ID', 'Details', 'Status', 'Action'].forEach((label) => {
            const th = document.createElement('th');
            th.style.cssText = 'text-align: left; padding: 10px; border-bottom: 2px solid #e2e8f0;';
            th.textContent = label;
            headRow.appendChild(th);
        });
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.appendChild(payoutCell(row.kind));
            tr.appendChild(payoutCell(row.user));
            tr.appendChild(payoutCell(row.detail));
            tr.appendChild(payoutCell(row.verified ? 'Verified' : 'Awaiting verification'));
            const action = payoutCell('');
            if (row.verified) {
                action.textContent = 'Verified';
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-primary';
                btn.textContent = 'Verify';
                btn.dataset.endpoint = row.endpoint;
                btn.addEventListener('click', () => verifyPayoutAccount(row.endpoint, btn));
                action.appendChild(btn);
            }
            tr.appendChild(action);
            body.appendChild(tr);
        }
        table.appendChild(body);
        container.replaceChildren(table);
    } catch (error) {
        console.error('Failed to load payout accounts', error);
        container.textContent = 'Payout accounts could not be loaded. Reload the page to try again.';
    }
}

async function verifyPayoutAccount(endpoint, button) {
    button.disabled = true;
    try {
        const response = await adminFetch(endpoint, { method: 'PUT' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'Verification failed');
        Swal.fire({ title: 'Verified', text: 'The payout account is verified and can be used for withdrawals.', icon: 'success', timer: 1800, showConfirmButton: false });
        loadPayoutAccounts();
    } catch (error) {
        button.disabled = false;
        Swal.fire({ title: 'Error', text: error.message || 'Verification failed', icon: 'error' });
    }
}

// Load withdrawal requests
async function loadWithdrawalRequests(statusFilter = '') {
    const container = document.getElementById('withdrawals-table-container');
    container.innerHTML = 'Loading...';

    try {
        // Fetch both old-style withdrawal requests and new transaction-based withdrawals
        const transactionsUrl = statusFilter
            ? `/api/admin/transactions/withdrawals?status_filter=${statusFilter}`
            : '/api/admin/transactions/withdrawals';

        const [requestsResponse, transactionsResponse] = await Promise.all([
            adminFetch(statusFilter ? `/api/admin/withdrawal-requests?status_filter=${statusFilter}` : '/api/admin/withdrawal-requests'),
            adminFetch(transactionsUrl)
        ]);

        const requestsData = await requestsResponse.json();
        const transactionsData = await transactionsResponse.json();

        // Combine both types of withdrawals
        let allWithdrawals = [];

        // Add old-style withdrawal requests (with type marker)
        if (requestsData.requests && requestsData.requests.length > 0) {
            allWithdrawals = allWithdrawals.concat(
                requestsData.requests.map(req => ({
                    ...req,
                    type: 'request', // Mark as old-style request
                    created_at: req.created_at
                }))
            );
        }

        // Add transaction-based withdrawals (with type marker)
        if (transactionsData.withdrawals && transactionsData.withdrawals.length > 0) {
            allWithdrawals = allWithdrawals.concat(
                transactionsData.withdrawals.map(txn => ({
                    id: txn.id,
                    username: txn.username,
                    email: txn.email,
                    amount: txn.amount,
                    withdrawal_method: txn.payment_method,
                    status: txn.status,
                    created_at: txn.created_at,
                    payment_details: txn.payment_details,
                    reference_number: txn.reference_number,
                    type: 'transaction' // Mark as transaction-based
                }))
            );
        }

        // Filter by status if needed
        if (statusFilter) {
            allWithdrawals = allWithdrawals.filter(w => w.status === statusFilter);
        }

        // Sort by date (newest first)
        allWithdrawals.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (allWithdrawals.length === 0) {
            container.innerHTML = '<p>No withdrawal requests found</p>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Verification Code</th>
                        <th>Date</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        allWithdrawals.forEach(req => {
            const date = new Date(req.created_at).toLocaleDateString();
            const statusBadge = req.status === 'completed' ? 'badge-approved' :
                              req.status === 'rejected' ? 'badge-rejected' :
                              req.status === 'pending_verification' ? 'badge-pending' : 'badge-pending';

            // Different action buttons for transaction-based vs request-based withdrawals
            let actionButtons = '';
            if (req.type === 'transaction') {
                actionButtons = `
                    <button class="btn btn-secondary" style="padding: 5px 10px;" data-action="view-transaction-withdrawal" data-request-id="${esc(req.id)}">View</button>
                    ${req.status === 'pending' ? `
                        <button class="btn btn-success" style="padding: 5px 10px;" data-action="complete-transaction-withdrawal" data-request-id="${esc(req.id)}">Complete</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" data-action="reject-transaction-withdrawal" data-request-id="${esc(req.id)}">Reject</button>
                    ` : ''}
                `;
            } else {
                actionButtons = `
                    <button class="btn btn-secondary" style="padding: 5px 10px;" data-action="view-withdrawal" data-request-id="${esc(req.id)}">View</button>
                    ${req.status === 'pending' ? `
                        <button class="btn btn-success" style="padding: 5px 10px;" data-action="approve-withdrawal" data-request-id="${esc(req.id)}">Approve</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" data-action="reject-withdrawal" data-request-id="${esc(req.id)}">Reject</button>
                    ` : ''}
                `;
            }

            const displayStatus = req.status === 'pending_verification' ? 'PENDING VERIFICATION' : req.status.toUpperCase();

            // Display verification code if available
            const verificationCodeDisplay = req.verification_code
                ? `<code style="background: #fff3cd; padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: 700; color: #D32F2F; letter-spacing: 1px;">${esc(req.verification_code)}</code>`
                : '-';

            html += `
                <tr>
                    <td>${esc(req.username)}<br><small style="color: #55657A;">${esc(req.email)}</small></td>
                    <td><strong>$${req.amount.toLocaleString()}</strong></td>
                    <td>${esc(req.withdrawal_method)}</td>
                    <td><span class="badge ${statusBadge}">${esc(displayStatus)}</span></td>
                    <td>${verificationCodeDisplay}</td>
                    <td>${date}</td>
                    <td>
                        <div class="action-buttons">
                            ${actionButtons}
                        </div>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading withdrawal requests</p>';
        console.error(error);
    }
}

// Filter withdrawal requests
function filterWithdrawalRequests() {
    const statusFilter = document.getElementById('withdrawal-status-filter').value;
    loadWithdrawalRequests(statusFilter);
}

// View withdrawal details
function viewWithdrawalDetails(requestId) {
    // Fetch the full withdrawal request data
    adminFetch(`/api/admin/withdrawal-requests?offset=0&limit=1000`)
        .then(response => response.json())
        .then(data => {
            const withdrawal = data.requests.find(req => req.id === requestId);
            if (!withdrawal) {
                Swal.fire({ title: 'Notice', text: 'Withdrawal request not found', icon: 'info' });
                return;
            }

            // Populate modal with withdrawal details
            const statusBadge = withdrawal.status === 'completed' ? 'badge-approved' :
                              withdrawal.status === 'rejected' ? 'badge-rejected' : 'badge-pending';
            const statusText = withdrawal.status === 'pending_verification' ? 'PENDING VERIFICATION' : withdrawal.status.toUpperCase();
            document.getElementById('wd-status-badge').innerHTML = `<span class="badge ${statusBadge}">${esc(statusText)}</span>`;
            document.getElementById('wd-amount').textContent = `$${withdrawal.amount.toLocaleString()}`;
            document.getElementById('wd-username').textContent = withdrawal.username || '-';
            document.getElementById('wd-email').textContent = withdrawal.email || '-';
            document.getElementById('wd-method').textContent = withdrawal.withdrawal_method;
            document.getElementById('wd-created').textContent = new Date(withdrawal.created_at).toLocaleString();
            document.getElementById('wd-reviewed').textContent = withdrawal.reviewed_at ? new Date(withdrawal.reviewed_at).toLocaleString() : 'Not reviewed';

            // Format account details as JSON for readability
            document.getElementById('wd-account-details').textContent = JSON.stringify(withdrawal.account_details, null, 2);

            // Show notes if available
            if (withdrawal.notes) {
                document.getElementById('wd-notes-container').style.display = 'block';
                document.getElementById('wd-notes').textContent = withdrawal.notes;
            } else {
                document.getElementById('wd-notes-container').style.display = 'none';
            }

            // Show verification code if available
            if (withdrawal.verification_code) {
                const verificationCodeContainer = document.getElementById('wd-verification-code-container');
                if (verificationCodeContainer) {
                    verificationCodeContainer.style.display = 'block';
                    document.getElementById('wd-verification-code').textContent = withdrawal.verification_code;

                    // Show verification status
                    if (withdrawal.code_verified_at) {
                        document.getElementById('wd-code-status').innerHTML =
                            `<span style="color: #4caf50;"><i class="fa fa-check-circle"></i> Verified at ${new Date(withdrawal.code_verified_at).toLocaleString()}</span>`;
                    } else {
                        document.getElementById('wd-code-status').innerHTML =
                            `<span style="color: #ff9800;"><i class="fa fa-clock"></i> Pending verification</span>`;
                    }
                }
            } else {
                const verificationCodeContainer = document.getElementById('wd-verification-code-container');
                if (verificationCodeContainer) {
                    verificationCodeContainer.style.display = 'none';
                }
            }

            // Show modal
            document.getElementById('withdrawal-details-modal').classList.add('show');
        })
        .catch(error => {
            console.error('Error loading withdrawal details:', error);
            Swal.fire({ title: 'Error!', text: 'Error loading withdrawal details', icon: 'error' });
        });
}

// Close withdrawal details modal
function closeWithdrawalDetailsModal() {
    document.getElementById('withdrawal-details-modal').classList.remove('show');
}

// Approve withdrawal
async function approveWithdrawal(requestId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Approve this withdrawal request? This will deduct the amount from the user wallet and mark as completed.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/withdrawal-requests/${requestId}/approve`, { method: 'PUT' });
        if (response.ok) {
            const data = await response.json();
            Swal.fire({ title: 'Success!', text: `Withdrawal approved! $${data.amount} deducted from user wallet.`, icon: 'success' });
            loadWithdrawalRequests();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to approve withdrawal'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Reject withdrawal
async function rejectWithdrawal(requestId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Reject this withdrawal request?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/withdrawal-requests/${requestId}/reject`, { method: 'PUT' });
        if (response.ok) {
            Swal.fire({ title: 'Notice', text: 'Withdrawal request rejected', icon: 'info' });
            loadWithdrawalRequests();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to reject withdrawal'));
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================
// TRANSACTION-BASED WITHDRAWAL FUNCTIONS
// ============================================================

// View transaction withdrawal details
async function viewTransactionWithdrawalDetails(transactionId) {
    try {
        const response = await adminFetch('/api/admin/transactions/withdrawals');
        const data = await response.json();

        const withdrawal = data.withdrawals.find(w => w.id === transactionId);
        if (!withdrawal) {
            Swal.fire({ title: 'Notice', text: 'Withdrawal transaction not found', icon: 'info' });
            return;
        }

        // Build details HTML
        let detailsHtml = `
            <div style="text-align: left; padding: 20px;">
                <div style="margin-bottom: 15px;">
                    <strong>Status:</strong> <span class="badge ${withdrawal.status === 'pending' ? 'badge-pending' : 'badge-approved'}">${esc(withdrawal.status.toUpperCase())}</span>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Amount:</strong> $${withdrawal.amount.toLocaleString()}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>User:</strong> ${esc(withdrawal.username)} (${esc(withdrawal.email)})
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Payment Method:</strong> ${esc(withdrawal.payment_method)}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Reference Number:</strong> ${esc(withdrawal.reference_number)}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Created:</strong> ${new Date(withdrawal.created_at).toLocaleString()}
                </div>
        `;

        // Add payment details if available
        if (withdrawal.payment_details) {
            detailsHtml += `
                <div style="margin-bottom: 15px;">
                    <strong>Payment Details:</strong>
                    <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${esc(JSON.stringify(withdrawal.payment_details, null, 2))}</pre>
                </div>
            `;

            // Highlight crypto details
            if (withdrawal.payment_details.crypto_type) {
                detailsHtml += `
                    <div style="margin-top: 20px; padding: 15px; background: rgba(123, 182, 218, 0.1); border-left: 3px solid #7BB6DA; border-radius: 5px;">
                        <h4 style="color: #D32F2F; margin-top: 0;">Cryptocurrency Withdrawal</h4>
                        <div style="margin-bottom: 10px;">
                            <strong>Crypto Type:</strong> ${esc(withdrawal.payment_details.crypto_type)}
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>User's Wallet Address:</strong><br>
                            <code style="background: #fff; padding: 5px; border-radius: 3px; word-break: break-all;">${esc(withdrawal.payment_details.wallet_address)}</code>
                        </div>
                        <div style="margin-top: 15px; padding: 10px; background: rgba(255, 152, 0, 0.1); border-radius: 5px;">
                            <i class="fas fa-info-circle"></i> <strong>Instructions:</strong>
                            <ol style="margin: 10px 0 0 0;">
                                <li>Send <strong>$${withdrawal.amount.toLocaleString()}</strong> worth of ${esc(withdrawal.payment_details.crypto_type)} to the user's wallet address above</li>
                                <li>Verify the transaction is confirmed on the blockchain</li>
                                <li>Click "Complete" to debit the amount from user's in-app wallet</li>
                            </ol>
                        </div>
                    </div>
                `;
            }
        }

        detailsHtml += '</div>';

        Swal.fire({
            title: 'Withdrawal Transaction Details',
            html: detailsHtml,
            width: '700px',
            confirmButtonText: 'Close'
        });
    } catch (error) {
        console.error('Error loading withdrawal details:', error);
        Swal.fire({ title: 'Error!', text: 'Error loading withdrawal details', icon: 'error' });
    }
}

// Complete transaction withdrawal
async function completeTransactionWithdrawal(transactionId) {
    const result = await Swal.fire({
        title: 'Confirm Withdrawal Completion',
        html: `
            <div style="text-align: left;">
                <p style="margin-bottom: 15px;">Have you confirmed that the cryptocurrency has been sent to the user's wallet address?</p>
                <div style="background: rgba(255, 152, 0, 0.1); padding: 15px; border-radius: 5px; border-left: 3px solid #ff9800;">
                    <strong><i class="fas fa-exclamation-triangle"></i> Important:</strong>
                    <ul style="margin: 10px 0 0 0;">
                        <li>This action will debit the amount from the user's in-app wallet</li>
                        <li>Make sure you have sent the cryptocurrency before completing</li>
                        <li>This action cannot be undone</li>
                    </ul>
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Complete Withdrawal',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#4caf50',
        width: '600px'
    });

    if (!result.isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/transactions/withdrawals/${transactionId}/complete`, { method: 'PUT' });
        if (response.ok) {
            const data = await response.json();
            Swal.fire({
                title: 'Success!',
                text: `Withdrawal completed! $${data.amount} deducted from user wallet.`,
                icon: 'success'
            });
            loadWithdrawalRequests();
        } else {
            const error = await response.json();
            Swal.fire({
                title: 'Error!',
                text: error.detail || 'Failed to complete withdrawal',
                icon: 'error'
            });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// Reject transaction withdrawal
async function rejectTransactionWithdrawal(transactionId) {
    if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Reject this withdrawal request? The user will be notified.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, Reject',
                cancelButtonText: 'Cancel'
            })).isConfirmed) return;

    try {
        const response = await adminFetch(`/api/admin/transactions/withdrawals/${transactionId}/reject`, { method: 'PUT' });
        if (response.ok) {
            Swal.fire({ title: 'Notice', text: 'Withdrawal request rejected', icon: 'info' });
            loadWithdrawalRequests();
        } else {
            const error = await response.json();
            Swal.fire({
                title: 'Error!',
                text: error.detail || 'Failed to reject withdrawal',
                icon: 'error'
            });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
}

// ============================================================================
// ACCESSIBILITY AND LAYOUT
// - Sidebar items are keyboard operable and expose the current page
// - Modals get dialog semantics, focus on open, focus trap, Escape to close,
//   focus return on close, and the page behind them is made inert
// - The sidebar becomes an off-canvas menu below 1024px
// ============================================================================

function syncMenuCurrent() {
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
    });
}

const modalTriggers = new WeakMap(); // modal element -> element focused before it opened

function getFocusable(root) {
    return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.offsetParent !== null || el === document.activeElement);
}

function openModals() {
    return [...document.querySelectorAll('.modal.show')];
}

function syncModals() {
    const open = openModals();
    const wrapper = document.querySelector('.dashboard-wrapper');
    if (wrapper) wrapper.inert = open.length > 0;

    document.querySelectorAll('.modal').forEach(modal => {
        const isOpen = modal.classList.contains('show');
        const hasTrigger = modalTriggers.has(modal);
        if (isOpen && !hasTrigger) {
            modalTriggers.set(modal, document.activeElement);
            requestAnimationFrame(() => {
                const content = modal.querySelector('.modal-content') || modal;
                const target = content.querySelector('[autofocus]') || getFocusable(content)[0] || content;
                target.focus();
            });
        } else if (!isOpen && hasTrigger) {
            const trigger = modalTriggers.get(modal);
            modalTriggers.delete(modal);
            if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus();
        }
    });
}

function closeTopModal() {
    const modal = openModals().pop();
    if (!modal) return false;
    // Prefer the modal's own Cancel/Close button so its cleanup handler runs
    const closer = [...modal.querySelectorAll('.btn-secondary')]
        .find(btn => ['Close', 'Cancel'].includes(btn.textContent.trim()));
    if (closer) closer.click();
    else modal.classList.remove('show');
    return true;
}

function setSidebarOpen(open) {
    const sidebar = document.getElementById('admin-sidebar');
    const toggle = document.getElementById('menu-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');
    const main = document.getElementById('main-content');
    if (!sidebar || !toggle) return;

    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    const isOpen = open && mobile;
    sidebar.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.textContent = '';
    toggle.append(Object.assign(document.createElement('i'), { className: `fas ${isOpen ? 'fa-xmark' : 'fa-bars'}` }), isOpen ? ' Close menu' : ' Menu');
    if (backdrop) backdrop.hidden = !isOpen;
    if (main) main.inert = isOpen;
    sidebar.inert = !isOpen && mobile;

    if (isOpen) {
        const first = sidebar.querySelector('.menu-item[data-tab].active') || sidebar.querySelector('.menu-item');
        if (first) first.focus();
    }
}

function initAccessibilityAndLayout() {
    // Modal semantics
    document.querySelectorAll('.modal').forEach(modal => {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const content = modal.querySelector('.modal-content');
        if (content) content.setAttribute('tabindex', '-1');
        const heading = content && content.querySelector('h1, h2, h3');
        if (heading) {
            if (!heading.id) heading.id = `${modal.id || 'modal'}-title`;
            modal.setAttribute('aria-labelledby', heading.id);
        }
    });

    // Sidebar items: make the divs keyboard operable
    document.querySelectorAll('.menu-item').forEach(item => {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
            }
        });
    });
    // Close the off-canvas menu after choosing a tab on small screens
    document.querySelectorAll('.menu-item[data-tab]').forEach(item => {
        item.addEventListener('click', () => setSidebarOpen(false));
    });
    syncMenuCurrent();

    // Mobile menu toggle and backdrop
    const toggle = document.getElementById('menu-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const isOpen = document.getElementById('admin-sidebar').classList.contains('is-open');
            setSidebarOpen(!isOpen);
            if (isOpen) toggle.focus();
        });
    }
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => { setSidebarOpen(false); if (toggle) toggle.focus(); });
    window.matchMedia('(max-width: 1023px)').addEventListener('change', () => setSidebarOpen(false));
    setSidebarOpen(false); // sets the initial off-canvas / inert state on small screens

    // Modal open/close tracking (covers every place that toggles .show)
    new MutationObserver(syncModals).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    syncModals();

    // Keyboard: Escape closes the top dialog or the mobile menu; Tab stays inside an open dialog
    document.addEventListener('keydown', (e) => {
        if (document.querySelector('.swal2-container')) return; // SweetAlert handles its own keys

        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-action][role="button"]')) {
            e.preventDefault();
            e.target.click();
            return;
        }

        if (e.key === 'Escape') {
            if (closeTopModal()) { e.preventDefault(); return; }
            if (document.getElementById('admin-sidebar')?.classList.contains('is-open')) {
                setSidebarOpen(false);
                if (toggle) toggle.focus();
            }
            return;
        }

        if (e.key === 'Tab') {
            const modal = openModals().pop();
            if (!modal) return;
            const content = modal.querySelector('.modal-content') || modal;
            const focusables = getFocusable(content);
            if (focusables.length === 0) { e.preventDefault(); content.focus(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (!content.contains(active)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        }
    });

    // Search: Enter submits the user search
    const search = document.getElementById('user-search');
    if (search) search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchUsers(); } });
}

document.addEventListener('DOMContentLoaded', initAccessibilityAndLayout);

