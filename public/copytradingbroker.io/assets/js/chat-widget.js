// Chat Widget JavaScript
class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.conversationId = null;
        this.pollingInterval = null;
        this.TOKEN_KEY = 'ted_access_token'; // Use same key as TED_AUTH
        this.init();
    }

    init() {
        this.injectStyles();
        this.createWidget();
        this.attachEventListeners();
        this.checkAuth();
        this.listenForAuthChanges();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Chat Widget Styles */
            .chat-widget-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 10002;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            }

            /* Desktop: halfway between center and bottom */
            @media (min-width: 992px) {
                .chat-widget-container {
                    bottom: 25vh !important;
                }
                .chat-window {
                    bottom: calc(25vh + 80px) !important;
                }
            }

            .chat-bubble {
                width: 70px;
                height: 70px;
                background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
                transition: all 0.3s ease;
                position: relative;
            }

            .chat-bubble:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(220, 38, 38, 0.5);
            }

            .chat-bubble svg {
                width: 32px;
                height: 32px;
                fill: white;
            }

            .chat-bubble-text {
                position: absolute;
                bottom: 80px;
                right: 0;
                background: #1f2937;
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 500;
                white-space: nowrap;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }

            .chat-bubble:hover .chat-bubble-text {
                opacity: 1;
                visibility: visible;
            }

            .chat-unread-badge {
                position: absolute;
                top: -5px;
                right: -5px;
                background: #10b981;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: bold;
                border: 2px solid white;
            }

            .chat-window {
                position: fixed;
                bottom: 90px;
                right: 20px;
                width: 380px;
                max-width: calc(100vw - 40px);
                height: 550px;
                max-height: calc(100vh - 120px);
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                display: flex;
                flex-direction: column;
                opacity: 0;
                visibility: hidden;
                transform: translateY(20px) scale(0.95);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                overscroll-behavior: contain;
            }

            .chat-window.open {
                opacity: 1;
                visibility: visible;
                transform: translateY(0) scale(1);
            }

            .chat-header {
                background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                color: white;
                padding: 16px 20px;
                border-radius: 12px 12px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .chat-header-title {
                font-size: 18px;
                font-weight: 600;
            }

            .chat-header-subtitle {
                font-size: 13px;
                opacity: 0.9;
                margin-top: 2px;
            }

            .chat-close-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s ease;
            }

            .chat-close-btn:hover {
                background: rgba(255, 255, 255, 0.3);
            }

            .chat-close-btn svg {
                width: 16px;
                height: 16px;
                fill: white;
            }

            .chat-messages {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 20px;
                background: #f9fafb;
                -webkit-overflow-scrolling: touch;
                scroll-behavior: smooth;
                overscroll-behavior: contain;
            }

            .chat-message {
                margin-bottom: 16px;
                display: flex;
                flex-direction: column;
            }

            .chat-message.user {
                align-items: flex-end;
            }

            .chat-message.admin {
                align-items: flex-start;
            }

            .chat-message-content {
                max-width: 75%;
                padding: 10px 14px;
                border-radius: 12px;
                word-wrap: break-word;
                word-break: break-word;
                overflow-wrap: break-word;
                font-size: 14px;
                line-height: 1.5;
            }

            .chat-message.user .chat-message-content {
                background: #dc2626;
                color: white;
                border-bottom-right-radius: 4px;
            }

            .chat-message.admin .chat-message-content {
                background: white;
                color: #1f2937;
                border: 1px solid #e5e7eb;
                border-bottom-left-radius: 4px;
            }

            .chat-message-sender {
                font-size: 12px;
                color: #6b7280;
                margin-bottom: 4px;
                font-weight: 500;
            }

            .chat-message-time {
                font-size: 11px;
                color: #9ca3af;
                margin-top: 4px;
            }

            .chat-input-container {
                padding: 16px 20px;
                border-top: 1px solid #e5e7eb;
                background: white;
                border-radius: 0 0 12px 12px;
            }

            .chat-input-wrapper {
                display: flex;
                gap: 8px;
            }

            .chat-input {
                flex: 1;
                padding: 10px 14px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                font-size: 14px;
                outline: none;
                transition: border-color 0.2s ease;
            }

            .chat-input:focus {
                border-color: #dc2626;
            }

            .chat-send-btn {
                background: #dc2626;
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 500;
                font-size: 14px;
                transition: background 0.2s ease;
            }

            .chat-send-btn:hover:not(:disabled) {
                background: #991b1b;
            }

            .chat-send-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .chat-empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                text-align: center;
                padding: 40px 20px;
                color: #6b7280;
            }

            .chat-empty-state svg {
                width: 64px;
                height: 64px;
                fill: #d1d5db;
                margin-bottom: 16px;
            }

            .chat-empty-state h3 {
                font-size: 18px;
                font-weight: 600;
                color: #1f2937;
                margin-bottom: 8px;
            }

            .chat-empty-state p {
                font-size: 14px;
                color: #6b7280;
            }

            .chat-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                color: #6b7280;
            }

            /* Tablet responsiveness */
            @media (max-width: 768px) {
                .chat-window {
                    width: 360px;
                    max-width: calc(100vw - 20px);
                    right: 10px;
                    bottom: 90px;
                }

                .chat-widget-container {
                    right: 10px;
                    bottom: 90px;
                }

                .chat-message-content {
                    max-width: 80%;
                    font-size: 13px;
                }

                .chat-header-title {
                    font-size: 16px;
                }

                .chat-header-subtitle {
                    font-size: 12px;
                }
            }

            /* Small tablet / large phone */
            @media (max-width: 600px) {
                .chat-window {
                    width: 100%;
                    max-width: calc(100vw - 20px);
                    height: 500px;
                    max-height: calc(100vh - 110px);
                    right: 10px;
                    bottom: 90px;
                }

                .chat-widget-container {
                    right: 10px;
                    bottom: 90px;
                }

                .chat-bubble {
                    width: 56px;
                    height: 56px;
                }

                .chat-bubble svg {
                    width: 26px;
                    height: 26px;
                }

                .chat-bubble-text {
                    font-size: 13px;
                    padding: 6px 12px;
                    bottom: 65px;
                }

                .chat-message-content {
                    max-width: 85%;
                    padding: 9px 12px;
                    font-size: 13px;
                }

                .chat-input {
                    font-size: 13px;
                    padding: 9px 12px;
                }

                .chat-send-btn {
                    font-size: 13px;
                    padding: 9px 14px;
                }
            }

            /* Mobile phone responsiveness */
            @media (max-width: 480px) {
                .chat-window {
                    bottom: 0;
                    right: 0;
                    left: 0;
                    width: 100%;
                    max-width: 100%;
                    height: 100vh;
                    max-height: 100vh;
                    border-radius: 0;
                }

                .chat-widget-container {
                    right: 15px;
                    bottom: 90px;
                }

                .chat-bubble {
                    width: 54px;
                    height: 54px;
                }

                .chat-bubble svg {
                    width: 24px;
                    height: 24px;
                }

                .chat-bubble-text {
                    display: none;
                }

                .chat-header {
                    border-radius: 0;
                    padding: 14px 16px;
                }

                .chat-header-title {
                    font-size: 16px;
                }

                .chat-header-subtitle {
                    font-size: 12px;
                }

                .chat-messages {
                    padding: 16px;
                }

                .chat-message {
                    margin-bottom: 14px;
                }

                .chat-message-content {
                    max-width: 80%;
                    padding: 8px 12px;
                    font-size: 14px;
                }

                .chat-message-sender {
                    font-size: 11px;
                }

                .chat-message-time {
                    font-size: 10px;
                }

                .chat-input-container {
                    border-radius: 0;
                    padding: 12px 16px;
                }

                .chat-input {
                    font-size: 14px;
                    padding: 10px 12px;
                }

                .chat-send-btn {
                    font-size: 14px;
                    padding: 10px 14px;
                }

                .chat-empty-state {
                    padding: 30px 20px;
                }

                .chat-empty-state svg {
                    width: 56px;
                    height: 56px;
                    margin-bottom: 12px;
                }

                .chat-empty-state h3 {
                    font-size: 16px;
                    margin-bottom: 6px;
                }

                .chat-empty-state p {
                    font-size: 13px;
                }
            }

            /* Very small screens */
            @media (max-width: 360px) {
                .chat-message-content {
                    max-width: 85%;
                    font-size: 13px;
                    padding: 8px 10px;
                }

                .chat-input-wrapper {
                    gap: 6px;
                }

                .chat-input {
                    font-size: 13px;
                    padding: 9px 10px;
                }

                .chat-send-btn {
                    font-size: 13px;
                    padding: 9px 12px;
                }

                .chat-header-title {
                    font-size: 15px;
                }

                .chat-unread-badge {
                    width: 22px;
                    height: 22px;
                    font-size: 10px;
                }
            }

            /* Landscape orientation on small devices */
            @media (max-height: 500px) and (orientation: landscape) {
                .chat-window {
                    height: 100vh;
                    max-height: 100vh;
                }

                .chat-messages {
                    padding: 12px 16px;
                }

                .chat-message {
                    margin-bottom: 10px;
                }

                .chat-input-container {
                    padding: 10px 16px;
                }

                .chat-empty-state {
                    padding: 20px;
                }

                .chat-empty-state svg {
                    width: 48px;
                    height: 48px;
                    margin-bottom: 8px;
                }

                .chat-empty-state h3 {
                    font-size: 15px;
                    margin-bottom: 4px;
                }

                .chat-empty-state p {
                    font-size: 12px;
                }
            }

            /* Fix iOS Safari input zoom */
            @media (max-width: 480px) {
                .chat-input {
                    font-size: 16px !important;
                }
            }

            /* Prevent body scroll when chat is open on mobile */
            body.chat-open-mobile {
                overflow: hidden;
                position: fixed;
                width: 100%;
            }
        `;
        document.head.appendChild(style);
    }

    createWidget() {
        const container = document.createElement('div');
        container.className = 'chat-widget-container';
        container.innerHTML = `
            <div class="chat-bubble" id="chatBubble">
                <div class="chat-bubble-text">Support</div>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                </svg>
                <div class="chat-unread-badge" id="chatUnreadBadge" style="display: none;">0</div>
            </div>

            <div class="chat-window" id="chatWindow">
                <div class="chat-header">
                    <div>
                        <div class="chat-header-title">Support Chat</div>
                        <div class="chat-header-subtitle">We typically reply in minutes</div>
                    </div>
                    <button class="chat-close-btn" id="chatCloseBtn">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                        </svg>
                    </button>
                </div>

                <div class="chat-messages" id="chatMessages">
                    <div class="chat-empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                        </svg>
                        <h3>How can we help?</h3>
                        <p>Send us a message and we'll get back to you as soon as possible.</p>
                    </div>
                </div>

                <div class="chat-input-container">
                    <div class="chat-input-wrapper">
                        <input type="text" class="chat-input" id="chatInput" placeholder="Type your message..." disabled />
                        <button class="chat-send-btn" id="chatSendBtn" disabled>Send</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
    }

    attachEventListeners() {
        const bubble = document.getElementById('chatBubble');
        const closeBtn = document.getElementById('chatCloseBtn');
        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');

        bubble.addEventListener('click', () => this.toggleChat());
        closeBtn.addEventListener('click', () => this.toggleChat());
        sendBtn.addEventListener('click', () => this.sendMessage());
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    }

    async checkAuth() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        const messagesContainer = document.getElementById('chatMessages');

        if (token) {
            // User is logged in - enable chat
            document.getElementById('chatInput').disabled = false;
            document.getElementById('chatSendBtn').disabled = false;

            // Clear login prompt and load conversation
            messagesContainer.innerHTML = `
                <div class="chat-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                    </svg>
                    <h3>How can we help?</h3>
                    <p>Send us a message and we'll get back to you as soon as possible.</p>
                </div>
            `;

            // Load conversation if chat is open
            if (this.isOpen) {
                await this.loadConversation();
            }

            // Start polling for new messages
            this.startPolling();
        } else {
            // User is not logged in - show login prompt
            document.getElementById('chatInput').disabled = true;
            document.getElementById('chatSendBtn').disabled = true;

            messagesContainer.innerHTML = `
                <div class="chat-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                    </svg>
                    <h3>Login Required</h3>
                    <p>Please <a href="/login" style="color: #dc2626; font-weight: 600;">login</a> to start chatting with support.</p>
                </div>
            `;

            // Stop polling
            this.stopPolling();
        }
    }

    async toggleChat() {
        const window = document.getElementById('chatWindow');
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            window.classList.add('open');
            // Prevent body scroll on mobile when chat is open
            if (window.innerWidth <= 480) {
                document.body.classList.add('chat-open-mobile');
            }
            await this.loadConversation();
        } else {
            window.classList.remove('open');
            // Re-enable body scroll
            document.body.classList.remove('chat-open-mobile');
        }
    }

    async loadConversation() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) return;

        try {
            const response = await fetch('/api/chat/conversation', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data) {
                    this.conversationId = data.id;
                    this.renderMessages(data.messages);
                }
            }
        } catch (error) {
            console.error('Error loading conversation:', error);
        }
    }

    renderMessages(messages) {
        const container = document.getElementById('chatMessages');

        if (!messages || messages.length === 0) {
            container.innerHTML = `
                <div class="chat-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                    </svg>
                    <h3>How can we help?</h3>
                    <p>Send us a message and we'll get back to you as soon as possible.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => `
            <div class="chat-message ${this.escapeHtml(msg.sender_type)}">
                <div class="chat-message-sender">${this.escapeHtml(msg.sender_name)}</div>
                <div class="chat-message-content">${this.escapeHtml(msg.message)}</div>
                <div class="chat-message-time">${this.formatTime(msg.created_at)}</div>
            </div>
        `).join('');

        container.scrollTop = container.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const sendBtn = document.getElementById('chatSendBtn');
        const message = input.value.trim();

        if (!message) return;

        const token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) {
            Swal.fire({ title: 'Warning', text: 'Please log in to send messages', icon: 'warning' });
            return;
        }

        // Disable button while sending
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        try {
            const response = await fetch('/api/chat/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: message,
                    conversation_id: this.conversationId
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (!this.conversationId) {
                    this.conversationId = data.conversation_id;
                }
                input.value = '';
                await this.loadConversation();
            } else {
                const error = await response.json();
                alert('Failed to send message: ' + (error.detail || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error sending message:', error);
            Swal.fire({ title: 'Error!', text: 'Failed to send message. Please try again.', icon: 'error' });
        } finally {
            // Re-enable button
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
        }
    }

    async checkUnreadCount() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) return;

        try {
            const response = await fetch('/api/chat/unread-count', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const badge = document.getElementById('chatUnreadBadge');
                if (data.unread_count > 0) {
                    badge.textContent = data.unread_count;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error checking unread count:', error);
        }
    }

    startPolling() {
        // Clear any existing interval first
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Check for new messages every 10 seconds
        this.pollingInterval = setInterval(() => {
            this.checkUnreadCount();
            if (this.isOpen) {
                this.loadConversation();
            }
        }, 10000);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    listenForAuthChanges() {
        // Listen for storage changes (when user logs in/out in another tab)
        window.addEventListener('storage', (e) => {
            if (e.key === this.TOKEN_KEY) {
                this.checkAuth();
            }
        });

        // Listen for custom login/logout events
        window.addEventListener('userLoggedIn', () => {
            this.checkAuth();
        });

        window.addEventListener('userLoggedOut', () => {
            this.stopPolling();
            this.conversationId = null;
            document.getElementById('chatInput').disabled = true;
            document.getElementById('chatSendBtn').disabled = true;

            const messagesContainer = document.getElementById('chatMessages');
            messagesContainer.innerHTML = `
                <div class="chat-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                    </svg>
                    <h3>Login Required</h3>
                    <p>Please <a href="/login" style="color: #dc2626; font-weight: 600;">login</a> to start chatting with support.</p>
                </div>
            `;

            // Hide unread badge
            document.getElementById('chatUnreadBadge').style.display = 'none';
        });

        // Check auth periodically (every 30 seconds) to catch session expiry
        setInterval(() => {
            const token = localStorage.getItem(this.TOKEN_KEY);
            if (!token && this.pollingInterval) {
                // Session expired, stop polling
                window.dispatchEvent(new Event('userLoggedOut'));
            } else if (token && !this.pollingInterval) {
                // Session restored, start polling
                window.dispatchEvent(new Event('userLoggedIn'));
            }
        }, 30000);
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

// Initialize chat widget when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ChatWidget());
} else {
    new ChatWidget();
}
