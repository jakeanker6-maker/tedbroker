/**
 * Admin Chat Management
 * Handles real-time chat functionality for admin dashboard
 */

class AdminChatManager {
    constructor() {
        this.currentConversationId = null;
        this.conversations = [];
        this.pollingInterval = null;
        this.messagePollingInterval = null;
        this.TOKEN_KEY = 'admin_token';
    }

    init() {
        // Start polling for conversations
        this.loadConversations();
        this.startPolling();

        // Listen for Enter key in chat input
        const chatInput = document.getElementById('admin-chat-input');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
    }

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    }

    async apiCall(endpoint, options = {}) {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(endpoint, {
            ...options,
            headers
        });

        if (response.status === 401) {
            window.location.href = '/admin-login';
        }

        return response;
    }

    async loadConversations(status = '') {
        try {
            let url = '/api/admin/chat/conversations';
            if (status) {
                url += `?status_filter=${status}`;
            }

            const response = await this.apiCall(url);
            if (response.ok) {
                const data = await response.json();
                this.conversations = data.conversations || [];
                this.renderConversations();
                this.updateChatBadge();
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
        }
    }

    renderConversations() {
        const container = document.getElementById('conversations-list');
        if (!container) return;

        if (this.conversations.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #8b93a7;">
                    <i class="fas fa-inbox" style="font-size: 48px; opacity: 0.3; margin-bottom: 12px;"></i>
                    <p>No conversations yet</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.conversations.map(conv => {
            const lastMessage = conv.last_message || 'No messages yet';
            const isActive = conv.id === this.currentConversationId;
            const unreadCount = conv.unread_count || 0;

            return `
                <div class="conversation-item ${isActive ? 'active' : ''}" data-action="select-conversation" data-conversation-id="${conv.id}">
                    <div class="conversation-user">
                        ${this.escapeHtml(conv.user_name || conv.user_email)}
                        ${unreadCount > 0 ? `<span class="conversation-unread">${unreadCount}</span>` : ''}
                    </div>
                    <div class="conversation-preview">${this.escapeHtml(lastMessage)}</div>
                    <div class="conversation-time">
                        ${this.formatTime(conv.last_message_time || conv.created_at)}
                        <span class="badge ${conv.status === 'active' ? 'badge-active' : 'badge-inactive'}" style="margin-left: 8px; font-size: 10px;">
                            ${conv.status}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async selectConversation(conversationId) {
        this.currentConversationId = conversationId;

        // Update UI
        this.renderConversations();

        // Load messages
        await this.loadMessages(conversationId);

        // Mark as read
        await this.markAsRead(conversationId);

        // Show chat interface
        document.getElementById('chat-placeholder').style.display = 'none';
        document.getElementById('chat-header').style.display = 'block';
        document.getElementById('chat-messages-container').style.display = 'block';
        document.getElementById('chat-input-area').style.display = 'block';

        // Update header
        const conversation = this.conversations.find(c => c.id === conversationId);
        if (conversation) {
            document.getElementById('chat-user-name').textContent = conversation.user_name || 'User';
            document.getElementById('chat-user-email').textContent = conversation.user_email;

            const statusBadge = document.getElementById('chat-status-badge');
            statusBadge.textContent = conversation.status.toUpperCase();
            statusBadge.className = 'badge ' + (conversation.status === 'active' ? 'badge-active' : 'badge-inactive');
        }

        // Start polling for new messages in this conversation
        this.startMessagePolling();
    }

    async loadMessages(conversationId) {
        try {
            const response = await this.apiCall(`/api/admin/chat/conversations/${conversationId}`);
            if (response.ok) {
                const conversation = await response.json();
                this.renderMessages(conversation.messages || []);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    renderMessages(messages) {
        const container = document.getElementById('chat-messages-container');
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #8b93a7; padding: 40px;">
                    <i class="fas fa-comment-slash" style="font-size: 48px; opacity: 0.3; margin-bottom: 12px;"></i>
                    <p>No messages in this conversation</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => `
            <div class="chat-message ${msg.sender_type}">
                <div class="chat-message-sender">${this.escapeHtml(msg.sender_name)}</div>
                <div class="chat-message-content">${this.escapeHtml(msg.message)}</div>
                <div class="chat-message-time">${this.formatTime(msg.created_at)}</div>
            </div>
        `).join('');

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    async sendMessage() {
        if (!this.currentConversationId) return;

        const input = document.getElementById('admin-chat-input');
        const message = input.value.trim();

        if (!message) return;

        try {
            const response = await this.apiCall(`/api/admin/chat/conversations/${this.currentConversationId}/reply`, {
                method: 'POST',
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                input.value = '';
                await this.loadMessages(this.currentConversationId);
                await this.loadConversations(); // Refresh conversation list
            } else {
                const error = await response.json();
                alert(error.detail || 'Failed to send message');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            Swal.fire({ title: 'Error!', text: 'Failed to send message', icon: 'error' });
        }
    }

    async markAsRead(conversationId) {
        try {
            await this.apiCall(`/api/admin/chat/conversations/${conversationId}/mark-read`, {
                method: 'POST'
            });
            // Refresh conversations to update unread count
            await this.loadConversations();
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    }

    async closeConversation() {
        if (!this.currentConversationId) return;

        if (!(await Swal.fire({
                title: 'Confirm Action',
                text: 'Are you sure you want to mark this conversation as resolved?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            })).isConfirmed) {
            return;
        }

        try {
            const response = await this.apiCall(`/api/admin/chat/conversations/${this.currentConversationId}/close`, {
                method: 'POST'
            });

            if (response.ok) {
                Swal.fire({ title: 'Notice', text: 'Conversation marked as resolved', icon: 'info' });
                this.currentConversationId = null;

                // Hide chat interface
                document.getElementById('chat-placeholder').style.display = 'flex';
                document.getElementById('chat-header').style.display = 'none';
                document.getElementById('chat-messages-container').style.display = 'none';
                document.getElementById('chat-input-area').style.display = 'none';

                await this.loadConversations();
            } else {
                const error = await response.json();
                alert(error.detail || 'Failed to close conversation');
            }
        } catch (error) {
            console.error('Error closing conversation:', error);
            Swal.fire({ title: 'Error!', text: 'Failed to close conversation', icon: 'error' });
        }
    }

    updateChatBadge() {
        const totalUnread = this.conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
        const badge = document.getElementById('chat-badge');

        if (badge) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    startPolling() {
        // Clear any existing interval
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Poll for new conversations every 5 seconds
        this.pollingInterval = setInterval(() => {
            this.loadConversations();
        }, 5000);
    }

    startMessagePolling() {
        // Clear any existing interval
        if (this.messagePollingInterval) {
            clearInterval(this.messagePollingInterval);
        }

        // Poll for new messages every 3 seconds when viewing a conversation
        this.messagePollingInterval = setInterval(() => {
            if (this.currentConversationId) {
                this.loadMessages(this.currentConversationId);
            }
        }, 3000);
    }

    stopMessagePolling() {
        if (this.messagePollingInterval) {
            clearInterval(this.messagePollingInterval);
            this.messagePollingInterval = null;
        }
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Global functions for onclick handlers
function sendAdminMessage() {
    adminChatManager.sendMessage();
}

function closeConversation() {
    adminChatManager.closeConversation();
}

function filterChats() {
    const status = document.getElementById('chat-status-filter').value;
    adminChatManager.loadConversations(status);
}

// Initialize when DOM is ready
const adminChatManager = new AdminChatManager();

// Auto-initialize when tab is switched to chats
document.addEventListener('DOMContentLoaded', () => {
    // Watch for tab changes
    const observer = new MutationObserver(() => {
        const chatsTab = document.getElementById('tab-chats');
        if (chatsTab && chatsTab.classList.contains('active')) {
            adminChatManager.init();
        } else {
            adminChatManager.stopMessagePolling();
        }
    });

    const chatsTab = document.getElementById('tab-chats');
    if (chatsTab) {
        observer.observe(chatsTab, { attributes: true, attributeFilter: ['class'] });
    }
});
