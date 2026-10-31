"""
Email Service using Postmark
Handles sending emails for 2FA verification codes
"""

import os
import json
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from app import email_templates


class EmailService:
    """Service for sending emails via Postmark"""

    def __init__(self):
        self.api_key = os.getenv("POSTMARK_API_KEY")
        self.from_email = os.getenv("POSTMARK_FROM_EMAIL", "noreply@tedbrokers.com")
        self.from_name = os.getenv("POSTMARK_FROM_NAME", "TED Brokers")
        self.api_url = "https://api.postmarkapp.com/email"

        if not self.api_key:
            print("WARNING: POSTMARK_API_KEY not configured. Email sending will be disabled.")

    def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        plain_content: Optional[str] = None
    ) -> bool:
        """
        Send an email via Postmark

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML content of the email
            plain_content: Plain text content (optional)

        Returns:
            bool: True if email sent successfully, False otherwise
        """
        if not self.api_key:
            print(f"⚠️  Postmark API key not configured!")
            print(f"Email would have been sent to {to_email}: {subject}")
            return False

        try:
            payload = {
                "From": f"{self.from_name} <{self.from_email}>",
                "To": to_email,
                "Subject": subject,
                "HtmlBody": html_content,
                "TextBody": plain_content or "",
                "TrackOpens": True
            }

            data = json.dumps(payload).encode("utf-8")
            req = Request(
                self.api_url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Postmark-Server-Token": self.api_key
                },
                method="POST"
            )

            with urlopen(req) as response:
                if response.status == 200:
                    print(f"✓ Email sent successfully to {to_email}")
                    print(f"  Subject: {subject}")
                    print(f"  Status: {response.status}")
                    return True
                else:
                    response_body = response.read().decode("utf-8")
                    print(f"✗ Email sending failed to {to_email}")
                    print(f"  Status: {response.status}")
                    print(f"  Response: {response_body}")
                    return False

        except HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else str(e)
            print(f"✗ Error sending email to {to_email}: {e.code} {e.reason}")
            print(f"  Response: {error_body}")
            return False
        except Exception as e:
            print(f"✗ Error sending email to {to_email}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def send_2fa_code(self, to_email: str, code: str, username: str = "User") -> bool:
        """Send the login verification code."""
        subject, html, text = email_templates.two_fa_code(username, code)
        return self.send_email(to_email, subject, html, text)

    def send_password_reset_code(self, to_email: str, code: str, username: str = "User") -> bool:
        """Send the password reset code."""
        subject, html, text = email_templates.password_reset_code(username, code)
        return self.send_email(to_email, subject, html, text)

    def send_login_notification(self, to_email: str, username: str, ip_address: str, device_info, location="Unknown") -> bool:
        """Send a new sign-in notification. device_info and location may be dicts or strings."""
        from datetime import datetime

        login_time = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")

        if isinstance(device_info, dict):
            browser_os = f"{device_info.get('browser', 'Unknown browser')} on {device_info.get('os', 'Unknown OS')}"
            device_type = device_info.get("device", "Unknown device")
        else:
            browser_os = str(device_info)
            device_type = "Unknown device"

        if isinstance(location, dict):
            location_display = f"{location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}"
        else:
            location_display = str(location)

        subject, html, text = email_templates.login_notification(
            username=username,
            login_time=login_time,
            ip_address=ip_address,
            location=location_display,
            device_type=device_type,
            browser_os=browser_os,
        )
        return self.send_email(to_email, subject, html, text)

    def send_deposit_notification(self, to_email: str, username: str, amount: float, payment_method: str) -> bool:
        """Send a deposit approval notification."""
        from datetime import datetime

        approved_at = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")
        subject, html, text = email_templates.deposit_approved(
            username=username,
            amount=f"${amount:,.2f}",
            method=str(payment_method),
            approved_at=approved_at,
        )
        return self.send_email(to_email, subject, html, text)

    def send_withdrawal_notification(self, to_email: str, username: str, amount: float, withdrawal_method: str, account_details: dict) -> bool:
        """Send a withdrawal approval notification. Account identifiers are masked."""
        from datetime import datetime

        processed_at = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")
        details = []
        if withdrawal_method == "bank":
            account_number = str(account_details.get("account_number", ""))
            details.append(("Bank", str(account_details.get("bank_name", "N/A"))))
            details.append(("Account", f"****{account_number[-4:]}"))
        else:
            wallet_address = str(account_details.get("wallet_address", ""))
            masked = f"{wallet_address[:6]}...{wallet_address[-4:]}" if len(wallet_address) > 10 else wallet_address
            details.append(("Currency", str(account_details.get("currency", "N/A"))))
            details.append(("Wallet", masked))

        subject, html, text = email_templates.withdrawal_processed(
            username=username,
            amount=f"${amount:,.2f}",
            method=str(withdrawal_method).title(),
            details=details,
            processed_at=processed_at,
        )
        return self.send_email(to_email, subject, html, text)


email_service = EmailService()
