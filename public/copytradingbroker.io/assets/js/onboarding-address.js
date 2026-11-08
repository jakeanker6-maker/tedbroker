// @ts-check
/**
 * Onboarding address step enhancements (loaded as a module after onboarding.js):
 * - Country: combobox with every country; free text that is not a country is rejected on submit.
 * - Street: address suggestions from GET /api/onboarding/address-suggestions. Picking one fills the
 *   street, city, state, ZIP and country. Manual entry always stays possible.
 */
import { filterCountries, findCountryByCode, findCountryByName } from './lib/countries.js';
import { createCombobox } from './lib/combobox.js';

const streetInput = /** @type {HTMLInputElement|null} */ (document.getElementById('street'));
const cityInput = /** @type {HTMLInputElement|null} */ (document.getElementById('city'));
const stateInput = /** @type {HTMLInputElement|null} */ (document.getElementById('state'));
const zipInput = /** @type {HTMLInputElement|null} */ (document.getElementById('zip_code'));
const countryInput = /** @type {HTMLInputElement|null} */ (document.getElementById('country'));
const streetList = /** @type {HTMLUListElement|null} */ (document.getElementById('street-listbox'));
const countryList = /** @type {HTMLUListElement|null} */ (document.getElementById('country-listbox'));
const statusEl = document.getElementById('onb-status');

/** Set a value and tell the page (onboarding.js clears inline errors on change) */
function fill(input, value) {
    if (!input) return;
    input.value = value || '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function announce(message) {
    if (statusEl) statusEl.textContent = message;
}

if (countryInput && countryList) {
    createCombobox({
        input: countryInput,
        listbox: countryList,
        openOnFocus: true,
        announce,
        source: async (query) => {
            // A value that is exactly a country name shows the full list again, so the user can pick another
            const term = findCountryByName(query) ? '' : query;
            return filterCountries(term).map(c => ({ label: c.name, data: c }));
        },
        onSelect: (item) => fill(countryInput, item.data.name),
    });
}

if (streetInput && streetList) {
    createCombobox({
        input: streetInput,
        listbox: streetList,
        minChars: 3,
        delay: 250,
        announce,
        source: async (query, signal) => {
            const response = await TED_AUTH.apiCall(
                `/api/onboarding/address-suggestions?q=${encodeURIComponent(query.trim())}`,
                { method: 'GET', signal }
            );
            // Lookup unavailable: no list, and the user keeps typing the address by hand
            if (!response.ok) {
                announce('Address suggestions are unavailable. Enter your address manually.');
                return [];
            }
            const data = await response.json().catch(() => ({ suggestions: [] }));
            return (data.suggestions || []).map(s => ({ label: s.label, data: s }));
        },
        onSelect: (item) => {
            const s = item.data;
            const country = findCountryByCode(s.country_code || '') || findCountryByName(s.country || '');
            fill(streetInput, s.street || item.label);
            fill(cityInput, s.city);
            fill(stateInput, s.state);
            fill(zipInput, s.zip_code);
            if (country) {
                fill(countryInput, country.name);
            } else if (s.country) {
                // Not in the list: leave the country for the user to choose
                fill(countryInput, '');
            }
            announce('Address filled in. Check the details below.');
            streetInput.focus();
        },
    });
}
