"""
TED Brokers transactional email templates ("Market Pulse" system).

Every email is built from one table-based layout so it renders consistently in
Outlook, Gmail, Apple Mail and mobile clients:
  - inline styles only, with a <style> block used just for mobile sizing
  - system font fallbacks (Sora/DM Sans/JetBrains Mono are progressive)
  - a bulletproof table button, no images required for the core message
  - no cards, badges or pills. Structure comes from an ink header band,
    hairline rules, a ruled ledger for details and large numerals for codes.

Each public function returns (subject, html, text). Every dynamic value is
HTML-escaped. Callers pass plain values; formatting lives here.
"""

from html import escape
from typing import Iterable, List, Optional, Sequence, Tuple

# ---- Tokens (from design/DESIGN.md, email-safe values) ----
INK = "#0A1626"
INK_2 = "#11223A"
PAPER = "#F7F8FA"
SURFACE = "#FFFFFF"
TEXT = "#0A1626"
MUTED = "#55657A"
BORDER = "#DCE2EA"
RED = "#E3262F"
RED_TEXT = "#C41E26"        # red text on white, AA
TEAL_TEXT = "#0A7F75"       # teal text on white, AA
LOSS_TEXT = "#C42B30"
WHITE = "#FFFFFF"
ON_INK_MUTED = "#9AA9BD"
SIGNAL_ON_INK = "#2EE6D3"

FONT_DISPLAY = "'Sora','Helvetica Neue',Helvetica,Arial,sans-serif"
FONT_TEXT = "'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif"
FONT_MONO = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Courier New',monospace"

SUPPORT_EMAIL = "support@tedbrokers.com"
SITE_URL = "https://copytradingbroker.io"
COPYRIGHT_YEAR = 2026

RISK_NOTE = (
    "Trading and copy trading carry a high level of risk and you can lose some or all "
    "of your capital. Past performance is not a reliable indicator of future results."
)


def _e(value) -> str:
    return escape("" if value is None else str(value), quote=True)


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def _preheader(text: str) -> str:
    """Hidden preview text shown in the inbox list."""
    return (
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;'
        f'mso-hide:all;">{_e(text)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>'
    )


def _button(label: str, href: str) -> str:
    """Bulletproof button: a table cell with a background, which Outlook renders correctly."""
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 0;">
  <tr>
    <td bgcolor="{RED}" style="background-color:{RED};border-radius:10px;">
      <a href="{_e(href)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:{FONT_TEXT};font-size:16px;font-weight:700;line-height:1;color:{WHITE};text-decoration:none;border-radius:10px;">{_e(label)}&nbsp;&rarr;</a>
    </td>
  </tr>
</table>"""


def _ledger(rows: Sequence[Tuple[str, str]]) -> str:
    """Ruled key/value table. Labels in small caps, values right-aligned in mono."""
    body = []
    for i, (label, value) in enumerate(rows):
        last = i == len(rows) - 1
        border = "" if last else f"border-bottom:1px solid {BORDER};"
        body.append(f"""
  <tr>
    <td class="ledger-label" style="padding:12px 0;{border}font-family:{FONT_TEXT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:{MUTED};vertical-align:top;width:40%;">{_e(label)}</td>
    <td class="ledger-value" align="right" style="padding:12px 0;{border}font-family:{FONT_MONO};font-size:14px;font-weight:500;color:{TEXT};text-align:right;vertical-align:top;word-break:break-word;">{_e(value)}</td>
  </tr>""")
    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0;border-top:1px solid {BORDER};">{''.join(body)}
</table>"""


def _code_digits(code: str) -> str:
    """Six large mono digits, each on its own underline. No box, no card."""
    cells = []
    for ch in code:
        cells.append(
            f'<td align="center" style="padding:0 6px;">'
            f'<div style="width:40px;padding:6px 0 10px 0;border-bottom:2px solid {INK};'
            f'font-family:{FONT_MONO};font-size:34px;font-weight:600;line-height:1;'
            f'color:{INK};text-align:center;">{_e(ch)}</div></td>'
        )
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
  <tr>{''.join(cells)}</tr>
</table>"""


def _paragraph(text_html: str, muted: bool = False, margin: str = "0 0 16px 0") -> str:
    color = MUTED if muted else TEXT
    return (
        f'<p style="margin:{margin};font-family:{FONT_TEXT};font-size:16px;line-height:1.55;'
        f'color:{color};">{text_html}</p>'
    )


def _notice(label: str, text: str, color: str = LOSS_TEXT) -> str:
    """Inline warning: a coloured dot and caps label, with no background box."""
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;border-top:1px solid {BORDER};">
  <tr>
    <td style="padding:16px 0 0 0;font-family:{FONT_TEXT};font-size:14px;line-height:1.55;color:{TEXT};">
      <span style="color:{color};font-family:{FONT_TEXT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">&#9679;&nbsp;{_e(label)}</span><br>
      {text}
    </td>
  </tr>
</table>"""


def _layout(*, subject: str, preheader: str, overline: str, title: str, body_html: str) -> str:
    """Full HTML document. `body_html` is already escaped/trusted markup."""
    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{_e(subject)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @media only screen and (max-width: 620px) {{
      .container {{ width: 100% !important; }}
      .px {{ padding-left: 22px !important; padding-right: 22px !important; }}
      .h1 {{ font-size: 24px !important; }}
      .ledger-label {{ width: auto !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background-color:{PAPER};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  {_preheader(preheader)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{PAPER}" style="background-color:{PAPER};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:{SURFACE};">

          <!-- Ink header band -->
          <tr>
            <td bgcolor="{INK}" class="px" style="background-color:{INK};padding:28px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:{FONT_DISPLAY};font-size:22px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                    <a href="{SITE_URL}" style="text-decoration:none;"><span style="color:{RED};">TED</span><span style="color:{WHITE};">&nbsp;Brokers</span></a>
                  </td>
                  <td align="right" style="font-family:{FONT_MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{ON_INK_MUTED};line-height:1;">
                    <span style="color:{SIGNAL_ON_INK};">&#9679;</span>&nbsp;{_e(overline)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="px" style="padding:44px 40px 36px 40px;">
              <h1 class="h1" style="margin:0 0 20px 0;font-family:{FONT_DISPLAY};font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:{TEXT};">{_e(title)}</h1>
              {body_html}
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td class="px" style="padding:0 40px 40px 40px;font-family:{FONT_TEXT};font-size:15px;line-height:1.55;color:{MUTED};">
              The TED Brokers team
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" bgcolor="{PAPER}" style="background-color:{PAPER};padding:28px 40px;border-top:1px solid {BORDER};font-family:{FONT_TEXT};font-size:12px;line-height:1.6;color:{MUTED};">
              <p style="margin:0 0 10px 0;font-family:{FONT_TEXT};font-size:12px;line-height:1.6;color:{MUTED};">{_e(RISK_NOTE)}</p>
              <p style="margin:0 0 10px 0;font-family:{FONT_TEXT};font-size:12px;line-height:1.6;color:{MUTED};">
                Questions? Reply to this email or write to <a href="mailto:{SUPPORT_EMAIL}" style="color:{TEXT};text-decoration:underline;">{SUPPORT_EMAIL}</a>.
              </p>
              <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.06em;color:{MUTED};">&copy; {COPYRIGHT_YEAR} TED Brokers &middot; <a href="{SITE_URL}/legal/privacy_policy" style="color:{MUTED};">Privacy</a> &middot; <a href="{SITE_URL}/legal/terms_conditions" style="color:{MUTED};">Terms</a> &middot; <a href="{SITE_URL}/legal/risk_closure" style="color:{MUTED};">Risk disclosure</a></p>
              <p style="margin:14px 0 0 0;font-family:{FONT_TEXT};font-size:11px;line-height:1.5;color:{MUTED};">You received this email because of activity on your TED Brokers account. Transactional emails cannot be unsubscribed from.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _greeting(username: str) -> str:
    return _paragraph(f"Hello {_e(username)},")


def _text_footer() -> str:
    return (
        f"\n--\n{RISK_NOTE}\n"
        f"Questions? Write to {SUPPORT_EMAIL}.\n"
        f"(c) {COPYRIGHT_YEAR} TED Brokers\n"
    )


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def two_fa_code(username: str, code: str) -> Tuple[str, str, str]:
    subject = "Your TED Brokers verification code"
    body = (
        _greeting(username)
        + _paragraph("Enter this code to finish signing in to your account.")
        + _code_digits(code)
        + _paragraph("It expires in <strong>10 minutes</strong> and can only be used once.", muted=True, margin="16px 0 0 0")
        + _notice(
            "Didn't ask for this?",
            "Ignore this email and do not share the code. Someone may have your password, so consider changing it.",
        )
    )
    html = _layout(
        subject=subject,
        preheader=f"Your verification code is {code}. It expires in 10 minutes.",
        overline="Verification",
        title="Your verification code",
        body_html=body,
    )
    text = (
        f"Hello {username},\n\n"
        f"Enter this code to finish signing in: {code}\n\n"
        "It expires in 10 minutes and can only be used once.\n\n"
        "Didn't ask for this? Ignore this email and do not share the code. "
        "Consider changing your password.\n"
        + _text_footer()
    )
    return subject, html, text


def password_reset_code(username: str, code: str) -> Tuple[str, str, str]:
    subject = "Reset your TED Brokers password"
    body = (
        _greeting(username)
        + _paragraph("Use this code to reset your password. Enter it on the reset page to continue.")
        + _code_digits(code)
        + _paragraph("It expires in <strong>10 minutes</strong>.", muted=True, margin="16px 0 0 0")
        + _notice(
            "Didn't request a reset?",
            "Your password has not changed. You can ignore this email. If you are worried, sign in and change it.",
        )
    )
    html = _layout(
        subject=subject,
        preheader=f"Your password reset code is {code}. It expires in 10 minutes.",
        overline="Password reset",
        title="Reset your password",
        body_html=body,
    )
    text = (
        f"Hello {username},\n\n"
        f"Your password reset code is: {code}\n\n"
        "It expires in 10 minutes. If you did not request a reset, ignore this email.\n"
        + _text_footer()
    )
    return subject, html, text


def login_notification(
    username: str,
    login_time: str,
    ip_address: str,
    location: str,
    device_type: str,
    browser_os: str,
) -> Tuple[str, str, str]:
    subject = "New sign-in to your TED Brokers account"
    rows = [
        ("Time", login_time),
        ("IP address", ip_address),
        ("Location", location),
        ("Device", device_type),
        ("Browser and OS", browser_os),
    ]
    body = (
        _greeting(username)
        + _paragraph("A sign-in to your account just completed. Here are the details:")
        + _ledger(rows)
        + _paragraph("If this was you, no action is needed.", muted=True, margin="20px 0 0 0")
        + _notice(
            "Not you?",
            f'Change your password now at <a href="{SITE_URL}/change-password" style="color:{RED_TEXT};">'
            "copytradingbroker.io</a> and contact support.",
        )
    )
    html = _layout(
        subject=subject,
        preheader=f"New sign-in from {location} at {login_time}.",
        overline="Account activity",
        title="New sign-in",
        body_html=body,
    )
    text = (
        f"Hello {username},\n\n"
        "A sign-in to your account just completed. Details:\n"
        f"- Time: {login_time}\n- IP address: {ip_address}\n- Location: {location}\n"
        f"- Device: {device_type}\n- Browser and OS: {browser_os}\n\n"
        "If this was you, no action is needed. If not, change your password and contact support.\n"
        + _text_footer()
    )
    return subject, html, text


def suspicious_login(
    username: str,
    risk_level: str,
    reasons: Iterable[str],
    ip_address: str,
    location: str,
    device: str,
    browser: str,
    os_name: str,
) -> Tuple[str, str, str]:
    subject = "Security alert: suspicious sign-in attempt"
    level = (risk_level or "low").upper()
    reason_list = list(reasons)
    reasons_html = "".join(
        f'<li style="margin:0 0 6px 0;">{_e(r)}</li>' for r in reason_list
    ) or f'<li style="margin:0 0 6px 0;">Unusual activity</li>'
    notice_html = (
        f'<p style="margin:0 0 8px 0;font-family:{FONT_TEXT};font-size:15px;color:{TEXT};">'
        f'Risk level: <strong style="color:{LOSS_TEXT};">{_e(level)}</strong></p>'
        f'<ul style="margin:8px 0 0 18px;padding:0;font-family:{FONT_TEXT};font-size:15px;line-height:1.55;color:{TEXT};">{reasons_html}</ul>'
    )
    rows = [
        ("IP address", ip_address),
        ("Location", location),
        ("Device", device),
        ("Browser", browser),
        ("Operating system", os_name),
    ]
    body = (
        _greeting(username)
        + _paragraph(
            "Someone tried to sign in to your account. The password matched, but the attempt was "
            "flagged for the reasons below. If this wasn't you, act now."
        )
        + _notice("Flagged", notice_html, color=LOSS_TEXT)
        + _paragraph("Attempt details", muted=True, margin="28px 0 0 0")
        + _ledger(rows)
        + _paragraph("What to do", muted=True, margin="28px 0 12px 0")
        + _paragraph(
            "Change your password and review your recent sign-ins. If you don't recognise this attempt, contact support.",
            margin="0 0 8px 0",
        )
        + _button("Change password", f"{SITE_URL}/change-password")
    )
    html = _layout(
        subject=subject,
        preheader=f"Risk level {level}. A sign-in attempt from {location} was flagged.",
        overline="Security alert",
        title="Suspicious sign-in attempt",
        body_html=body,
    )
    text = (
        f"Hello {username},\n\n"
        "Someone tried to sign in to your account. The password matched, but the attempt was flagged.\n\n"
        f"Risk level: {level}\n" + "".join(f"- {r}\n" for r in reason_list) + "\n"
        f"IP address: {ip_address}\nLocation: {location}\nDevice: {device}\n"
        f"Browser: {browser}\nOperating system: {os_name}\n\n"
        f"If this wasn't you, change your password: {SITE_URL}/change-password\n"
        + _text_footer()
    )
    return subject, html, text


def successful_login(
    username: str, ip_address: str, location: str, device: str, browser: str
) -> Tuple[str, str, str]:
    from datetime import datetime

    return login_notification(
        username=username,
        login_time=datetime.utcnow().strftime("%d %b %Y, %H:%M UTC"),
        ip_address=ip_address,
        location=location,
        device_type=device,
        browser_os=browser,
    )


def deposit_approved(username: str, amount: str, method: str, approved_at: str) -> Tuple[str, str, str]:
    subject = "Deposit approved"
    rows = [
        ("Amount", amount),
        ("Payment method", method),
        ("Approved", approved_at),
    ]
    body = (
        _greeting(username)
        + _paragraph("Your deposit has been approved and credited to your wallet.")
        + _ledger(rows)
        + _paragraph(
            "Past performance is not a guarantee of future returns. Your balance can go down as well as up.",
            muted=True,
            margin="20px 0 0 0",
        )
        + _button("Open your wallet", f"{SITE_URL}/app/wallet.html")
    )
    html = _layout(
        subject=subject,
        preheader=f"{amount} deposit approved via {method}.",
        overline="Wallet",
        title="Deposit approved",
        body_html=body,
    )
    text = (
        f"Hello {username},\n\n"
        "Your deposit has been approved and credited to your wallet.\n\n"
        f"- Amount: {amount}\n- Payment method: {method}\n- Approved: {approved_at}\n\n"
        f"Open your wallet: {SITE_URL}/app/wallet.html\n"
        + _text_footer()
    )
    return subject, html, text


def withdrawal_processed(
    username: str,
    amount: str,
    method: str,
    details: Sequence[Tuple[str, str]],
    processed_at: str,
) -> Tuple[str, str, str]:
    subject = "Withdrawal processed"
    rows = [("Amount", amount), ("Method", method), *details, ("Processed", processed_at)]
    body = (
        _greeting(username)
        + _paragraph("Your withdrawal has been approved and is being processed.")
        + _ledger(rows)
        + _paragraph(
            "Funds usually arrive within 2 to 5 business days, depending on your bank or network.",
            muted=True,
            margin="20px 0 0 0",
        )
    )
    html = _layout(
        subject=subject,
        preheader=f"{amount} withdrawal via {method} is being processed.",
        overline="Wallet",
        title="Withdrawal processed",
        body_html=body,
    )
    detail_text = "".join(f"- {label}: {value}\n" for label, value in details)
    text = (
        f"Hello {username},\n\n"
        "Your withdrawal has been approved and is being processed.\n\n"
        f"- Amount: {amount}\n- Method: {method}\n{detail_text}- Processed: {processed_at}\n\n"
        "Funds usually arrive within 2 to 5 business days.\n"
        + _text_footer()
    )
    return subject, html, text


def trading_alert(username: str, title: str, message: str, rows: Sequence[Tuple[str, str]],
                  link_path: str = "/app/trade.html") -> Tuple[str, str, str]:
    """Price / % move / order-filled alert from the simulated Trading Hub."""
    subject = f"Alert: {title}"
    body = (
        _greeting(username)
        + _paragraph(_e(message))
        + _ledger(rows)
        + _button("Open the Trading Hub", f"{SITE_URL}{link_path}")
    )
    html = _layout(subject=subject, preheader=message, overline="Alert", title=title, body_html=body)
    text = (
        f"Hello {username},\n\n{message}\n\n"
        + "".join(f"- {k}: {v}\n" for k, v in rows)
        + f"\nOpen the Trading Hub: {SITE_URL}{link_path}\n"
        + _text_footer()
    )
    return subject, html, text
