"""
IP-Based Security Alerts Service
Sends email alerts for suspicious login activity
"""

from datetime import datetime
from typing import Dict
from app.email_service import email_service
from app import email_templates


class SecurityAlertsService:
    """Service for sending security alerts to users"""

    @staticmethod
    def send_suspicious_login_alert(
        email: str,
        username: str,
        suspicious_activity: Dict,
        ip_address: str,
        device_info: Dict,
        location: Dict
    ) -> bool:
        """Send a security alert for a flagged sign-in attempt."""
        if not suspicious_activity.get("is_suspicious"):
            return False

        device_info = device_info or {}
        location = location or {}
        location_display = f"{location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}"

        subject, html_content, plain_content = email_templates.suspicious_login(
            username=username,
            risk_level=suspicious_activity.get("risk_level", "low"),
            reasons=suspicious_activity.get("reasons", []),
            ip_address=ip_address,
            location=location_display,
            device=device_info.get("device", "Unknown"),
            browser=device_info.get("browser", "Unknown"),
            os_name=device_info.get("os", "Unknown"),
        )
        return email_service.send_email(
            to_email=email,
            subject=subject,
            html_content=html_content,
            plain_content=plain_content,
        )

    @staticmethod
    def send_successful_login_notification(
        email: str,
        username: str,
        ip_address: str,
        device_info: Dict,
        location: Dict
    ) -> bool:
        """Send a notification for a sign-in from a new location or device."""
        device_info = device_info or {}
        location = location or {}
        location_display = f"{location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}"

        subject, html_content, plain_content = email_templates.successful_login(
            username=username,
            ip_address=ip_address,
            location=location_display,
            device=device_info.get("device", "Unknown"),
            browser=device_info.get("browser", "Unknown"),
        )
        return email_service.send_email(
            to_email=email,
            subject=subject,
            html_content=html_content,
            plain_content=plain_content,
        )


# Create singleton instance
security_alerts_service = SecurityAlertsService()
