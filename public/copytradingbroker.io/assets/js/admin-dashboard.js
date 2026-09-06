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

    // Load data for specific tabs
    if (tab === 'users') loadUsers();
    if (tab === 'traders') loadTraders();
    if (tab === 'plans') loadPlans();
    if (tab === 'etf-plans') loadETFPlans();
    if (tab === 'defi-plans') loadDeFiPlans();
    if (tab === 'options-plans') loadOptionsPlans();
    if (tab === 'deposits') loadDepositRequests();
    if (tab === 'withdrawals') loadWithdrawalRequests();
    if (tab === 'bank-accounts') loadBankAccounts();
    if (tab === 'crypto-wallets') loadCryptoWallets();
    if (tab === 'notifications') loadNotifications();
    if (tab === 'chats') {
        // Initialize chat manager if not already initialized
        if (typeof adminChatManager !== 'undefined') {
            adminChatManager.init();
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

// Load users with full onboarding data
async function loadUsers(search = '') {
    const container = document.getElementById('users-table-container');
    container.innerHTML = 'Loading...';

    try {
        const url = search ? `/api/admin/users?search=${encodeURIComponent(search)}` : '/api/admin/users';
        const response = await adminFetch(url);
        const data = await response.json();

        if (data.users.length === 0) {
            container.innerHTML = '<p>No users found</p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';

        // For each user, fetch full details including onboarding data
        for (const user of data.users) {
            // Fetch detailed user data
            let fullUserData = user;
            try {
                const detailResponse = await adminFetch(`/api/admin/users/${user.id}`);
                fullUserData = await detailResponse.json();
            } catch (err) {
                console.error(`Error fetching details for user ${user.id}:`, err);
            }

            const kyc = fullUserData.kyc || {};
            const date = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A';
            const statusBadge = `badge-${user.is_active ? 'active' : 'inactive'}`;
            const verifiedBadge = user.is_verified ? '<span class="badge badge-approved" style="margin-left: 8px; font-size: 11px;">Verified</span>' : '<span class="badge badge-pending" style="margin-left: 8px; font-size: 11px;">Unverified</span>';

            // KYC status badge
            let kycStatusClass = 'badge-pending';
            let kycStatusText = 'Not Submitted';
            if (kyc.kyc_status === 'approved') {
                kycStatusClass = 'badge-approved';
                kycStatusText = 'Approved';
            } else if (kyc.kyc_status === 'rejected') {
                kycStatusClass = 'badge-rejected';
                kycStatusText = 'Rejected';
            } else if (kyc.kyc_status === 'not_submitted') {
                kycStatusText = 'Not Submitted';
            } else if (kyc.kyc_status) {
                kycStatusText = kyc.kyc_status.replace('_', ' ').toUpperCase();
            }

            html += `
                <div style="border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                    <!-- User Header -->
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #f7fafc;">
                        <div style="flex: 1;">
                            <h3 style="margin: 0 0 8px 0; color: #2D3748; display: flex; align-items: center; font-size: 20px;">
                                <i class="fas fa-user-circle" style="color: #D32F2F; margin-right: 12px; font-size: 24px;"></i>
                                ${user.username}
                                <span class="badge ${statusBadge}" style="margin-left: 12px;">${user.is_active ? 'Active' : 'Inactive'}</span>
                                ${verifiedBadge}
                            </h3>
                            <p style="margin: 0; color: #8b93a7; font-size: 14px;">
                                <i class="fas fa-envelope" style="margin-right: 6px;"></i>
                                ${user.email}
                            </p>
                        </div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <button class="btn btn-primary" style="padding: 10px 18px;" onclick="viewUser('${user.id}')">
                                <i class="fas fa-eye"></i> Full Details
                            </button>
                            ${kyc.kyc_completed || kyc.address_completed || kyc.personal_info_completed ?
                                `<button class="btn btn-warning" style="padding: 10px 18px;" onclick="rejectKYC('${user.id}')">
                                    <i class="fas fa-times-circle"></i> Reject KYC
                                </button>` : ''
                            }
                            ${user.access_granted ?
                                `<button class="btn btn-danger" style="padding: 10px 18px;" onclick="revokeAccess('${user.id}')">
                                    <i class="fas fa-lock"></i> Revoke Access
                                </button>` :
                                `<button class="btn btn-success" style="padding: 10px 18px;" onclick="grantAccess('${user.id}')">
                                    <i class="fas fa-unlock"></i> Grant Access
                                </button>`
                            }
                            ${user.is_active ?
                                `<button class="btn btn-danger" style="padding: 10px 18px;" onclick="deactivateUser('${user.id}')">
                                    <i class="fas fa-ban"></i> Deactivate
                                </button>` :
                                `<button class="btn btn-success" style="padding: 10px 18px;" onclick="activateUser('${user.id}')">
                                    <i class="fas fa-check"></i> Activate
                                </button>`
                            }
                        </div>
                    </div>

                    <!-- Basic Info Section -->
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 12px 0; color: #2D3748; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">
                            <i class="fas fa-info-circle" style="margin-right: 8px; color: #D32F2F;"></i>
                            Account Information
                        </h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 16px; background: #f7fafc; border-radius: 8px; border-left: 4px solid #D32F2F;">
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Full Name</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">${user.full_name || '-'}</p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Phone</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">${user.phone || '-'}</p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Country</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                    ${user.country ? `<i class="fas fa-globe" style="margin-right: 6px;"></i>${user.country}` : '-'}
                                </p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Gender</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">${user.gender || '-'}</p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Wallet Balance</label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <p style="margin: 0; color: #D32F2F; font-size: 20px; font-weight: 700;">
                                        <i class="fas fa-wallet" style="margin-right: 6px; font-size: 16px;"></i>
                                        $${user.wallet_balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                    </p>
                                    <button class="btn btn-sm btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="showUpdateBalanceModal('${user.id}', ${user.wallet_balance})">
                                        <i class="fas fa-edit"></i> Update
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Auth Provider</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">${fullUserData.auth_provider || 'local'}</p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Referral Code</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                    ${user.referral_code ? `<code style="background: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${user.referral_code}</code>` : '-'}
                                </p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Referred By</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">${user.referred_by || '-'}</p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Account Created</label>
                                <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                    <i class="fas fa-calendar" style="margin-right: 6px;"></i>
                                    ${date}
                                </p>
                            </div>
                            <div>
                                <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">User ID</label>
                                <p style="margin: 0; color: #2D3748; font-family: monospace; font-size: 11px;">${user.id}</p>
                            </div>
                        </div>
                    </div>

                    <!-- KYC/Onboarding Section -->
                    <div style="margin-bottom: 0;">
                        <h4 style="margin: 0 0 12px 0; color: #2D3748; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between;">
                            <span>
                                <i class="fas fa-id-card" style="margin-right: 8px; color: #D32F2F;"></i>
                                KYC / Onboarding Information
                            </span>
                            <span class="badge ${kycStatusClass}" style="font-size: 11px;">${kycStatusText}</span>
                        </h4>

                        <!-- Personal Information -->
                        <div style="margin-bottom: 16px;">
                            <h5 style="margin: 0 0 8px 0; color: #5a5a5a; font-size: 12px; font-weight: 600; text-transform: uppercase;">Personal Information</h5>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; padding: 14px; background: #fffbf5; border-radius: 8px; border-left: 3px solid #ff9800;">
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">First Name</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.first_name || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Last Name</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.last_name || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Gender</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.gender || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Completed</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.personal_info_completed ? '<i class="fas fa-check-circle" style="color: #4caf50;"></i> Yes' : '<i class="fas fa-times-circle" style="color: #f44336;"></i> No'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Address Information -->
                        <div style="margin-bottom: 16px;">
                            <h5 style="margin: 0 0 8px 0; color: #5a5a5a; font-size: 12px; font-weight: 600; text-transform: uppercase;">Address Information</h5>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; padding: 14px; background: #f0f9ff; border-radius: 8px; border-left: 3px solid #2196F3;">
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Street Address</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.street || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">City</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.city || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">State/Province</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.state || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">ZIP/Postal Code</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${kyc.zip_code || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Country</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.country ? `<i class="fas fa-globe" style="margin-right: 6px;"></i>${kyc.country}` : '-'}
                                    </p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Completed</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.address_completed ? '<i class="fas fa-check-circle" style="color: #4caf50;"></i> Yes' : '<i class="fas fa-times-circle" style="color: #f44336;"></i> No'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Verification Documents -->
                        <div>
                            <h5 style="margin: 0 0 8px 0; color: #5a5a5a; font-size: 12px; font-weight: 600; text-transform: uppercase;">Verification Documents</h5>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; padding: 14px; background: #f3f4f6; border-radius: 8px; border-left: 3px solid #6366f1;">
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Document Number</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.document_number ? `<code style="background: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${kyc.document_number}</code>` : '-'}
                                    </p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Document Photo</label>
                                    ${kyc.document_photo ? `
                                        <a href="${kyc.document_photo}" target="_blank" style="text-decoration: none;">
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <img src="${kyc.document_photo}" alt="ID Document" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; border: 2px solid #4caf50;">
                                                <span style="color: #4caf50; font-weight: 600;">
                                                    <i class="fas fa-check-circle"></i> View Document
                                                </span>
                                            </div>
                                        </a>
                                    ` : '<p style="margin: 0; color: #2D3748; font-weight: 600;"><i class="fas fa-times-circle" style="color: #f44336;"></i> Not Uploaded</p>'}
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">KYC Submitted</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.kyc_submitted_at ? new Date(kyc.kyc_submitted_at).toLocaleDateString() : '-'}
                                    </p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Completed</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.kyc_completed ? '<i class="fas fa-check-circle" style="color: #4caf50;"></i> Yes' : '<i class="fas fa-times-circle" style="color: #f44336;"></i> No'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Investment Questionnaire -->
                        <div style="margin-top: 16px;">
                            <h5 style="margin: 0 0 8px 0; color: #5a5a5a; font-size: 12px; font-weight: 600; text-transform: uppercase;">Investment Questionnaire</h5>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; padding: 14px; background: #fdf2f8; border-radius: 8px; border-left: 3px solid #D32F2F;">
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Risk Tolerance</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${{'very_low':'Very Low','low':'Low','moderate':'Moderate','high':'High','very_high':'Very High'}[kyc.risk_tolerance] || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Annual Income</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${{'under_10k':'Less than $10,000','10k_50k':'$10,000 - $50,000','50k_100k':'$50,000 - $100,000','100k_1m':'$100,000 - $1,000,000','over_1m':'More than $1,000,000'}[kyc.annual_income] || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Employment Status</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">${{'unemployed':'Unemployed','self_employed':'Self-Employed','part_time':'Part Time','full_time':'Full Time','retired':'Retired'}[kyc.employment_status] || '-'}</p>
                                </div>
                                <div>
                                    <label style="display: block; color: #8b93a7; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Completed</label>
                                    <p style="margin: 0; color: #2D3748; font-weight: 600;">
                                        ${kyc.questionnaire_completed ? '<i class="fas fa-check-circle" style="color: #4caf50;"></i> Yes' : '<i class="fas fa-times-circle" style="color: #f44336;"></i> No'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = '<p style="color: red;">Error loading users. Please try again.</p>';
    }
}

// Search users
function searchUsers() {
    const search = document.getElementById('user-search').value;
    loadUsers(search);
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

    try {
        const response = await adminFetch(`/api/admin/users/${userId}`);
        const user = await response.json();

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
        if (kyc.document_photo) {
            // Add a clickable link to open the image in a new tab for full-size viewing
            docContainer.innerHTML = `
                <div style="text-align: center;">
                    <a href="${kyc.document_photo}" target="_blank" style="display: inline-block; position: relative;">
                        <img src="${kyc.document_photo}" alt="KYC Document" style="max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); cursor: pointer;">
                        <div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px;">
                            <i class="fas fa-external-link-alt"></i> Click to open full size
                        </div>
                    </a>
                    <p style="margin-top: 12px; font-size: 13px; color: #8b93a7;">
                        <i class="fas fa-file-image"></i> Document uploaded
                    </p>
                </div>
            `;
        } else {
            docContainer.innerHTML = '<p style="color: #8b93a7;">No document uploaded</p>';
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
            historyContainer.innerHTML = '<p style="text-align: center; color: #8b93a7; padding: 40px;">No login history available</p>';
        } else {
            let historyHtml = '';
            loginHistory.forEach(login => {
                const successClass = login.success ? '' : ' failed';
                const statusIcon = login.success ? '<i class="fas fa-check-circle" style="color: #4caf50;"></i>' : '<i class="fas fa-times-circle" style="color: #f44336;"></i>';
                const timestamp = new Date(login.timestamp).toLocaleString();

                historyHtml += `
                    <div class="login-history-item${successClass}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${statusIcon}
                                <strong>${login.success ? 'Successful Login' : 'Failed Login'}</strong>
                            </div>
                            <span style="color: #8b93a7; font-size: 13px;">${timestamp}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
                            <div>
                                <strong>IP Address:</strong> ${login.ip_address || 'Unknown'}
                            </div>
                            <div>
                                <strong>Location:</strong> ${login.location ? `${login.location.city}, ${login.location.country}` : 'Unknown'}
                            </div>
                            <div>
                                <strong>Device:</strong> ${login.device_info ? login.device_info.device : 'Unknown'}
                            </div>
                            <div>
                                <strong>Browser:</strong> ${login.device_info ? login.device_info.browser : 'Unknown'}
                            </div>
                            ${!login.success && login.failure_reason ? `<div style="grid-column: span 2; color: #f44336;"><strong>Reason:</strong> ${login.failure_reason}</div>` : ''}
                        </div>
                    </div>
                `;
            });
            historyContainer.innerHTML = historyHtml;
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
            loadUsers(); // Reload user list to show updated balance
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
        loadUsers();
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
        loadUsers();
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
        loadUsers();
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
        loadUsers();
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
        loadUsers();
    } catch (error) {
        TED_AUTH.closeLoading();
        Swal.fire({
            title: 'Error!',
            text: error.message || 'Error rejecting KYC',
            icon: 'error'
        });
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
            container.innerHTML = '<p>No traders found. <button class="btn btn-primary" onclick="showAddTraderModal()">Add First Trader</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        traders.forEach(trader => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${trader.full_name}</h4>
                    <p>${trader.description}</p>
                    <p><strong>Specialization:</strong> ${trader.specialization}</p>
                    <p><strong>YTD Return:</strong> ${trader.ytd_return}% | <strong>Win Rate:</strong> ${trader.win_rate}%</p>
                    <p><strong>Copiers:</strong> ${trader.copiers || 0}</p>
                    <p><strong>Minimum Copy Amount:</strong> $${(trader.minimum_copy_amount || 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                    <p><strong>Assets Under Management:</strong> $${(trader.assets_under_management || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} | <strong>Max Drawdown:</strong> ${trader.max_drawdown || 0}% | <strong>Risk Score:</strong> ${trader.risk_score || 5}/10</p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="showEditTraderModal('${trader.id}')">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" onclick="deleteTrader('${trader.id}')">Delete</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p style="color: red;">Error loading traders</p>';
    }
}

// Show add trader modal
function showAddTraderModal() {
    const modal = document.getElementById('addTraderModal');
    modal.classList.add('show');

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
}

// Handle add trader form submission
async function handleAddTraderSubmit(e) {
    e.preventDefault();

    const formData = {
        full_name: document.getElementById('trader-full-name').value,
        profile_photo: document.getElementById('trader-profile-photo').value,
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

// Show edit trader modal
async function showEditTraderModal(traderId) {
    try {
        // Fetch trader details
        const response = await adminFetch(`/api/admin/traders/${traderId}`);
        const trader = await response.json();

        // Populate form fields
        document.getElementById('edit-trader-id').value = trader.id;
        document.getElementById('edit-trader-full-name').value = trader.full_name;
        document.getElementById('edit-trader-profile-photo').value = trader.profile_photo;
        document.getElementById('edit-trader-description').value = trader.description;
        document.getElementById('edit-trader-specialization').value = trader.specialization;
        document.getElementById('edit-trader-ytd-return').value = trader.ytd_return;
        document.getElementById('edit-trader-win-rate').value = trader.win_rate;
        document.getElementById('edit-trader-copiers').value = trader.copiers || 0;
        document.getElementById('edit-trader-minimum-amount').value = trader.minimum_copy_amount || 100;
        document.getElementById('edit-trader-aum').value = trader.assets_under_management || 0;
        document.getElementById('edit-trader-max-drawdown').value = trader.max_drawdown || 0;
        document.getElementById('edit-trader-risk-score').value = trader.risk_score || 5;

        // Show modal
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
    }
}

// Submit edited trader
async function submitEditedTrader(event) {
    event.preventDefault();

    const traderId = document.getElementById('edit-trader-id').value;
    const traderData = {
        full_name: document.getElementById('edit-trader-full-name').value,
        profile_photo: document.getElementById('edit-trader-profile-photo').value,
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
            Swal.fire({ title: 'Success!', text: 'Trader updated successfully!', icon: 'success' });
            hideEditTraderModal();
            loadTraders();
        } else {
            const error = await response.json();
            Swal.fire({ title: 'Error!', text: `Error: ${error.detail || 'Failed to update trader'}`, icon: 'error' });
        }
    } catch (error) {
        Swal.fire({ title: 'Error!', text: 'Network error. Please try again.', icon: 'error' });
        console.error(error);
    }
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
            container.innerHTML = '<p>No plans found. <button class="btn btn-primary" onclick="showAddPlanModal()">Add First Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${plan.name}</h4>
                    <p>${plan.description}</p>
                    <p><strong>Min Investment:</strong> $${plan.minimum_investment.toLocaleString()}</p>
                    <p><strong>Return:</strong> ${plan.expected_return_percent}% | <strong>Period:</strong> ${plan.holding_period_months} months</p>
                    <p><strong>Subscribers:</strong> ${plan.current_subscribers || 0}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="showEditPlanModal('${plan.id}')">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" onclick="deletePlan('${plan.id}')">Delete</button>
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
        is_active: document.getElementById('plan-active').checked
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
        is_active: document.getElementById('edit-plan-active').checked
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
            container.innerHTML = '<p>No ETF plans found. <button class="btn btn-primary" onclick="showAddETFPlanModal()">Add First ETF Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${plan.name}</h4>
                    <p><strong>Type:</strong> ${plan.plan_type}</p>
                    ${plan.description ? `<p>${plan.description}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${plan.expected_return_percent}% | <strong>Duration:</strong> ${plan.duration_months} months</p>
                    <p><strong>Min Investment:</strong> $${plan.minimum_investment.toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="showEditETFPlanModal('${plan.id}')">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" onclick="deleteETFPlan('${plan.id}')">Delete</button>
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
        is_active: document.getElementById('etf-plan-active').checked
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
        is_active: document.getElementById('edit-etf-plan-active').checked
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
            container.innerHTML = '<p>No DeFi plans found. <button class="btn btn-primary" onclick="showAddDeFiPlanModal()">Add First DeFi Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${plan.name}</h4>
                    <p><strong>Portfolio Type:</strong> ${plan.portfolio_type}</p>
                    ${plan.description ? `<p>${plan.description}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${plan.expected_return_percent}% | <strong>Duration:</strong> ${plan.duration_months} months</p>
                    <p><strong>Min Investment:</strong> $${plan.minimum_investment.toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="showEditDeFiPlanModal('${plan.id}')">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" onclick="deleteDeFiPlan('${plan.id}')">Delete</button>
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
        is_active: document.getElementById('defi-plan-active').checked
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
        is_active: document.getElementById('edit-defi-plan-active').checked
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
            container.innerHTML = '<p>No Options plans found. <button class="btn btn-primary" onclick="showAddOptionsPlanModal()">Add First Options Plan</button></p>';
            return;
        }

        let html = '<div style="display: grid; gap: 20px;">';
        plans.forEach(plan => {
            html += `
                <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h4>${plan.name}</h4>
                    <p><strong>Plan Type:</strong> ${plan.plan_type}</p>
                    ${plan.description ? `<p>${plan.description}</p>` : ''}
                    <p><strong>Expected Return:</strong> ${plan.expected_return_percent}% | <strong>Duration:</strong> ${plan.duration_months > 0 ? plan.duration_months + ' months' : 'Ongoing'}</p>
                    <p><strong>Min Investment:</strong> $${plan.minimum_investment.toLocaleString()}</p>
                    <p><span class="badge badge-${plan.is_active ? 'active' : 'inactive'}">${plan.is_active ? 'Active' : 'Inactive'}</span></p>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="showEditOptionsPlanModal('${plan.id}')">Edit</button>
                        <button class="btn btn-danger" style="padding: 8px 16px;" onclick="deleteOptionsPlan('${plan.id}')">Delete</button>
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
        is_active: document.getElementById('options-plan-active').checked
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
        is_active: document.getElementById('edit-options-plan-active').checked
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
            const statusBadge = `badge-${req.status}`;
            html += `
                <tr>
                    <td>${req.username}<br><small style="color: #8b93a7;">${req.email}</small></td>
                    <td><strong>$${req.amount.toLocaleString()}</strong></td>
                    <td>${req.payment_method}</td>
                    <td><span class="badge ${statusBadge}">${req.status}</span></td>
                    <td>${date}</td>
                    <td>
                        ${req.status === 'pending' ? `
                            <div class="action-buttons">
                                <button class="btn btn-success" style="padding: 5px 10px;" onclick="approveDeposit('${req.id}')">Approve</button>
                                <button class="btn btn-danger" style="padding: 5px 10px;" onclick="rejectDeposit('${req.id}')">Reject</button>
                            </div>
                        ` : `<span style="color: #8b93a7;">Reviewed</span>`}
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
            container.innerHTML = '<p>No crypto wallets found. <button class="btn btn-primary" onclick="showAddCryptoWalletModal()">Add First Wallet</button></p>';
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
                    <td><strong>${wallet.currency}</strong></td>
                    <td><code style="background: #f7fafc; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${wallet.wallet_address}</code></td>
                    <td>${wallet.network || 'N/A'}</td>
                    <td><span class="badge badge-${wallet.is_active ? 'active' : 'inactive'}">${wallet.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>${date}</td>
                    <td>
                        <button class="btn btn-primary" style="padding: 5px 10px; margin-right: 5px;" onclick="showEditCryptoWalletModal('${wallet.id}')"><i class="fas fa-edit"></i> Edit</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteCryptoWallet('${wallet.id}')"><i class="fas fa-trash"></i> Delete</button>
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
            container.innerHTML = '<p>No bank accounts found. <button class="btn btn-primary" onclick="showAddBankAccountModal()">Add First Account</button></p>';
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
                    <td><strong>${account.bank_name}</strong></td>
                    <td>${account.account_name}</td>
                    <td><code style="background: #f7fafc; padding: 4px 8px; border-radius: 4px;">${account.account_number}</code></td>
                    <td>${account.routing_number || 'N/A'}</td>
                    <td>${account.swift_code || 'N/A'}</td>
                    <td><span class="badge badge-${account.is_active ? 'active' : 'inactive'}">${account.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteBankAccount('${account.id}')">Delete</button>
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
            container.innerHTML = '<p>No notifications found. <button class="btn btn-primary" onclick="showCreateNotificationModal()">Create First Notification</button></p>';
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
            const typeColor = typeColors[notif.notification_type] || '#8b93a7';

            html += `
                <tr>
                    <td><strong>${notif.title}</strong><br><small style="color: #8b93a7;">${notif.message.substring(0, 50)}${notif.message.length > 50 ? '...' : ''}</small></td>
                    <td><span class="badge" style="background: ${typeColor};">${notif.notification_type.toUpperCase()}</span></td>
                    <td>${notif.target_type === 'all' ? '<strong>All Users</strong>' : 'Specific User'}</td>
                    <td>${date}</td>
                    <td>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteNotification('${notif.id}')">Delete</button>
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
                resultsDiv.innerHTML = '<p style="padding: 10px; color: #8b93a7;">No users found</p>';
                resultsDiv.style.display = 'block';
                return;
            }

            let html = '';
            data.users.forEach(user => {
                html += `
                    <div style="padding: 10px; cursor: pointer; border-bottom: 1px solid #e2e8f0; hover: background-color: #f7fafc;" onclick="selectUserForNotification('${user.id}', '${user.username}', '${user.email}')">
                        <strong>${user.username}</strong><br>
                        <small style="color: #8b93a7;">${user.email}</small>
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
                    <button class="btn btn-secondary" style="padding: 5px 10px;" onclick="viewTransactionWithdrawalDetails('${req.id}')">View</button>
                    ${req.status === 'pending' ? `
                        <button class="btn btn-success" style="padding: 5px 10px;" onclick="completeTransactionWithdrawal('${req.id}')">Complete</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="rejectTransactionWithdrawal('${req.id}')">Reject</button>
                    ` : ''}
                `;
            } else {
                actionButtons = `
                    <button class="btn btn-secondary" style="padding: 5px 10px;" onclick="viewWithdrawalDetails('${req.id}')">View</button>
                    ${req.status === 'pending' ? `
                        <button class="btn btn-success" style="padding: 5px 10px;" onclick="approveWithdrawal('${req.id}')">Approve</button>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="rejectWithdrawal('${req.id}')">Reject</button>
                    ` : ''}
                `;
            }

            const displayStatus = req.status === 'pending_verification' ? 'PENDING VERIFICATION' : req.status.toUpperCase();

            // Display verification code if available
            const verificationCodeDisplay = req.verification_code
                ? `<code style="background: #fff3cd; padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: 700; color: #D32F2F; letter-spacing: 1px;">${req.verification_code}</code>`
                : '-';

            html += `
                <tr>
                    <td>${req.username}<br><small style="color: #8b93a7;">${req.email}</small></td>
                    <td><strong>$${req.amount.toLocaleString()}</strong></td>
                    <td>${req.withdrawal_method}</td>
                    <td><span class="badge ${statusBadge}">${displayStatus}</span></td>
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
            document.getElementById('wd-status-badge').innerHTML = `<span class="badge ${statusBadge}">${statusText}</span>`;
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
                    <strong>Status:</strong> <span class="badge ${withdrawal.status === 'pending' ? 'badge-pending' : 'badge-approved'}">${withdrawal.status.toUpperCase()}</span>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Amount:</strong> $${withdrawal.amount.toLocaleString()}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>User:</strong> ${withdrawal.username} (${withdrawal.email})
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Payment Method:</strong> ${withdrawal.payment_method}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Reference Number:</strong> ${withdrawal.reference_number}
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
                    <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${JSON.stringify(withdrawal.payment_details, null, 2)}</pre>
                </div>
            `;

            // Highlight crypto details
            if (withdrawal.payment_details.crypto_type) {
                detailsHtml += `
                    <div style="margin-top: 20px; padding: 15px; background: rgba(123, 182, 218, 0.1); border-left: 3px solid #7BB6DA; border-radius: 5px;">
                        <h4 style="color: #D32F2F; margin-top: 0;">Cryptocurrency Withdrawal</h4>
                        <div style="margin-bottom: 10px;">
                            <strong>Crypto Type:</strong> ${withdrawal.payment_details.crypto_type}
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>User's Wallet Address:</strong><br>
                            <code style="background: #fff; padding: 5px; border-radius: 3px; word-break: break-all;">${withdrawal.payment_details.wallet_address}</code>
                        </div>
                        <div style="margin-top: 15px; padding: 10px; background: rgba(255, 152, 0, 0.1); border-radius: 5px;">
                            <i class="fas fa-info-circle"></i> <strong>Instructions:</strong>
                            <ol style="margin: 10px 0 0 0;">
                                <li>Send <strong>$${withdrawal.amount.toLocaleString()}</strong> worth of ${withdrawal.payment_details.crypto_type} to the user's wallet address above</li>
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
