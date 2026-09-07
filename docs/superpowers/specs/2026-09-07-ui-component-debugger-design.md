# Design: ui-component-debugger Skill

## Purpose

A source-code-first skill for comprehensively inspecting and debugging web UI components in vanilla HTML/CSS/JS projects. Traverses the entire DOM tree, validates all interactive elements, checks event handler wiring, CSS integrity, and data flow — reporting broken elements with suggested fixes.

## Core Principle

Every interactive element must have a verified, callable handler. Every CSS rule must resolve. Every data path must be traceable from source to DOM.

## Trigger Conditions

Use when:
- Debugging UI functionality
- Testing button/link click actions
- Validating form submissions and data flow
- Diagnosing CSS rendering issues
- Performing comprehensive UI audits
- Verifying no broken elements exist

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Vanilla HTML/CSS/JS | User's project stack |
| Scope | General purpose | Reusable across projects |
| Automation | Hybrid (manual + scripts) | Flexibility for different use cases |
| Reporting | Inline terminal report | Fast feedback during debugging |
| Focus areas | Click actions, data flow, CSS, dynamic behavior | User priority (accessibility deferred) |
| Inspection depth | Complete DOM tree | Thorough coverage |
| Issue handling | Report + suggested fixes | Actionable without auto-modifying |

## 5-Phase Inspection Flow

### Phase 1: DOM Tree Discovery
- Scan all HTML files (glob for `**/*.html`, `**/*.htm`, `**/*.jinja`, `**/*.jinja2`, `**/*.j2`, `**/*.ejs`, `**/*.hbs`, `**/*.mustache`)
- Build complete element inventory per file
- Map parent-child relationships, identify root/leaf nodes
- Flag template engines (Jinja2, EJS, etc.) for server-side rendering context

### Phase 2: Interactive Element Audit
- Find all clickable/interactive elements:
  - `<button>`, `<a>`, `[onclick]`, `[role="button"]`, `[tabindex]`
  - `<form>`, `<input>`, `<select>`, `<textarea>`, `<label>`
  - Elements with CSS `cursor: pointer`
- Extract inline handlers: `onclick`, `onsubmit`, `onchange`, `onmouseover`, etc.
- Extract `href` targets from links
- Extract `action` URLs from forms

### Phase 3: Handler Integrity Check
- For each inline handler (e.g., `onclick="doSomething()"`):
  - Search all JS files for function definition: `function doSomething`, `const doSomething =`, `doSomething =`
  - Verify function is in scope (not inside unreachable block)
  - Check parameter count matches call site
- For each `addEventListener` call:
  - Verify target element exists in DOM
  - Verify callback function is defined
- Check for common typos: `onclick="doSometing()"` (missing 'h')

### Phase 4: CSS & Rendering Validation
- Parse all CSS files and `<style>` blocks
- Verify selectors match at least one element (no orphaned rules)
- Check for conflicting rules on same element
- Validate responsive breakpoints reference valid selectors
- Check for `display: none` or `visibility: hidden` on interactive elements
- Flag missing `cursor: pointer` on clickable elements

### Phase 5: Data Flow Tracing
- Trace form submissions: `<form action="...">` → verify endpoint path exists
- Trace AJAX/fetch calls: search for `fetch(`, `$.ajax`, `XMLHttpRequest` → verify URL references
- Check that response handlers exist (`.then`, `.catch`, `onload`, `onerror`)
- Verify form input `name` attributes match expected server-side field names
- Check hidden fields for expected values

## Output Format

```
UI Component Debug Report: {page/file}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Passing: {N} elements verified
❌ Broken: {N} issues found

Issues:
1. [CRITICAL] {Element} → {attribute}="{value}" — {problem}
   Fix: {suggested fix}

2. [WARNING] {Element} → {attribute}="{value}" — {problem}
   Fix: {suggested fix}

3. [INFO] {Element} — {observation}
   Fix: {suggested improvement}
```

Severity levels:
- **CRITICAL**: Function will crash, link is dead, form won't submit
- **WARNING**: Likely broken, degraded behavior, missing validation
- **INFO**: Optimization opportunity, best practice suggestion

## Skill Structure

Single file: `SKILL.md` — all patterns inline, no supporting files needed.

## Integration with Existing Skills

- Complements `systematic-debugging` (uses its root cause methodology)
- Follows `verification-before-completion` principles (evidence before claims)
- Does NOT replace `frontend-design` (different purpose: creation vs debugging)

## Edge Cases Handled

1. **Template engines**: Flag Jinja2/EJS syntax as server-rendered, note that handlers may be injected at runtime
2. **Minified JS**: Detect minification patterns, suggest checking unminified source
3. **Third-party scripts**: Flag external CDN scripts as out-of-scope for handler verification
4. **Dynamic DOM**: Note that dynamically created elements won't appear in source HTML
5. **Shadow DOM**: Flag shadow roots as requiring special inspection
