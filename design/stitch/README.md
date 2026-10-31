# Stitch exports: TED Brokers "Market Pulse" redesign

- **Stitch project:** `1731547555331538383` ("TED Brokers — Market Pulse Redesign")
- **Design system asset:** `assets/15021897282927324350` (Sora / DM Sans / JetBrains Mono; TED red `#E3262F`, ink `#0A1626`, teal `#2EE6D3`)
- **File naming:** each screen exists as `<name>.png` (full-resolution screenshot) and `<name>.html` (Stitch Tailwind HTML, reference only and not for shipping).

## Public pages
| File | Screen ID | Notes |
|---|---|---|
| public-01-home-desktop | fb828e88dbbe4b69b656d26ed044c0f0 | key screen |
| public-02-how-it-works | 7d71ae599a9b4824a6434e3d0c739652 | replication diagram, earnings simulator |
| public-03-for-traders | 9c259bca2394461bb489ee7c203f98c8 | inline-number earnings calculator |
| public-04-about | a92c84a4c43c4f8da7047b7afb970843 | its nav differs from the others; implementation should use the home nav |
| public-05-help-contact | 8c37cae3e6b645e3b77c2925a9e2b2ec | FAQ and contact merged |
| public-06-sign-in | 17cb24ca8b5d40979d26f5d21e858667 | includes an error state |
| public-07-sign-up | a2bee970770641fd81e6545c61461703 | 3-step rail |
| public-08-home-mobile | 8df11f7d1dbc4b21b27f40d570328d2e | 390px |

## User dashboard
| File | Screen ID | Notes |
|---|---|---|
| dashboard-01-overview | 08d0a346cbd340d3a6795f675b10973c | final; **reference shell** for all dashboard pages |
| dashboard-02-copy-traders | 8a6d722b9d35428dbdebb3831ba92a7f | refined; expanded-row pattern |
| dashboard-03-wallet-deposit | c13c8aea87dd415dbe438cadc09d656c | deposit dialog |
| dashboard-04-investment-plans | 3e6acf1a89594c49ac346902d982338d | unified shell; risk/return bubble map |
| dashboard-05-portfolio | f8fdc438629842909d292fb72c5cc959 | refined |
| dashboard-06-referrals | a5b668bacd6245b28a4a5be335bff105 | |
| dashboard-07-settings-security | 64e8c529f7084fa899b30fcbde4a5e8d | original (the "unified shell" edit broke the layout and was discarded) |
| dashboard-08-overview-mobile | 27c0d27f402b4ff89bb96520bd851bcf | 390px, bottom tab bar |

## Fix during implementation (Stitch artefacts)

**Use one dashboard shell.** Build every dashboard page on the shell from `dashboard-01-overview`. Several screens still differ in:
- wordmark variants
- whether the ticker sits above or below the top bar
- uppercase nav (`portfolio`)

**Remove invented claims.** Stitch made up the following; remove all of them (see brief.md, "Honesty flag"):
- "FSCA & FSA licensed", "Tier-1 custody", "LD4 Equinix", "CRN", "Trustpilot", "latency SLA"
- "guaranteed limits", "audited" wording

**Remove residual boxes and badges** to meet the no-cards / no-badges rule:
- the bordered panel around the live chart in the home hero
- the `+24.5% · 30d` box
- the boxed allocation input on the plans screen
- the boxed "Copy ref" and wire-reference box in the deposit dialog

**Fix layout glitches:**
- portfolio ledger: the date overlaps the P/L
- copy traders: `$1,000` touches "Collapse"
- home "Top traders" table: header columns are offset

**Fill in what Stitch didn't design:**
- empty, loading and error states for every ledger
- light theme (the dashboard keeps its existing theme toggle)
- RTL mirroring for Arabic
- reduced-motion handling
