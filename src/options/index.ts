import { StorageService } from '../utils/storage';
import { OpenRouterService } from '../api/openrouter';
import { MODEL_OPTIONS } from '../constants/models';

// UI Elements
let apiKeyInput: HTMLInputElement;
let summaryModelSelect: HTMLSelectElement;
let qaModelSelect: HTMLSelectElement;
let summaryLengthSelect: HTMLSelectElement;
let autoSummarizeCheckbox: HTMLInputElement | null;
let saveButton: HTMLButtonElement;
let testButton: HTMLButtonElement;
let clearCacheButton: HTMLButtonElement;
let messageDiv: HTMLElement;

function populateModelSelect(select: HTMLSelectElement): void {
  while (select.firstChild) {
    select.removeChild(select.firstChild);
  }
  for (const option of MODEL_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.id;
    opt.textContent = option.label;
    select.appendChild(opt);
  }
}

// Initialize options page
document.addEventListener('DOMContentLoaded', async () => {
  // Get elements
  apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  summaryModelSelect = document.getElementById('summaryModel') as HTMLSelectElement;
  qaModelSelect = document.getElementById('qaModel') as HTMLSelectElement;
  summaryLengthSelect = document.getElementById('summaryLength') as HTMLSelectElement;
  autoSummarizeCheckbox = document.getElementById('autoSummarize') as HTMLInputElement | null;
  saveButton = document.getElementById('saveBtn') as HTMLButtonElement;
  testButton = document.getElementById('testBtn') as HTMLButtonElement;
  clearCacheButton = document.getElementById('clearCacheBtn') as HTMLButtonElement;
  messageDiv = document.getElementById('message') as HTMLElement;

  populateModelSelect(summaryModelSelect);
  populateModelSelect(qaModelSelect);

  // Load current settings
  await loadSettings();
  
  // Update storage info
  await updateStorageInfo();
  
  // Set up event listeners
  saveButton.addEventListener('click', saveSettings);
  testButton.addEventListener('click', testConnection);
  clearCacheButton.addEventListener('click', clearCache);
  
  // Auto-save on input change
  const inputs = [apiKeyInput, summaryModelSelect, qaModelSelect, summaryLengthSelect, autoSummarizeCheckbox].filter(
    (input): input is HTMLInputElement | HTMLSelectElement => input !== null
  );
  inputs.forEach(input => {
    input.addEventListener('change', () => {
      showMessage('Settings have unsaved changes', 'info');
    });
  });
});

// Load settings from storage
async function loadSettings() {
  try {
    const apiKey = await StorageService.getApiKey();
    const preferences = await StorageService.getPreferences();
    
    if (apiKey) {
      apiKeyInput.value = apiKey;
    }

    summaryModelSelect.value = preferences.summaryModel;
    qaModelSelect.value = preferences.qaModel;
    summaryLengthSelect.value = preferences.summaryLength;
    if (autoSummarizeCheckbox) {
      autoSummarizeCheckbox.checked = preferences.autoSummarize;
    }
  } catch (error: any) {
    showMessage('Failed to load settings', 'error');
  }
}

// Save settings
async function saveSettings() {
  try {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showMessage('Please enter an API key', 'error');
      return;
    }
    
    // Save API key
    await StorageService.setApiKey(apiKey);
    
    // Save preferences
    await StorageService.setPreferences({
      summaryModel: summaryModelSelect.value,
      qaModel: qaModelSelect.value,
      summaryLength: summaryLengthSelect.value as 'concise' | 'normal' | 'extended',
      autoSummarize: autoSummarizeCheckbox?.checked || false,
      language: 'en',
    });
    
    showMessage('Settings saved successfully!', 'success');
    
    // Notify background script to reinitialize
    chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED' });
  } catch (error: any) {
    showMessage('Failed to save settings', 'error');
  }
}

// Test OpenRouter connection
async function testConnection() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showMessage('Please enter an API key first', 'error');
    return;
  }
  
  testButton.disabled = true;
  testButton.textContent = 'Testing...';
  
  try {
    // Test the API key against the summary model
    const openRouter = new OpenRouterService({
      apiKey,
      model: summaryModelSelect.value || 'google/gemini-2.5-flash-lite',
      maxTokens: 120,
    });
    
    // Make a simple test request
    await openRouter.generateSummary('This is a test transcript.');
    
    showMessage('Connection successful! API key is valid.', 'success');
  } catch (error: any) {
    showMessage(`Connection failed: ${error.message}`, 'error');
  } finally {
    testButton.disabled = false;
    testButton.textContent = 'Test Connection';
  }
}

// Clear cache
async function clearCache() {
  if (!confirm('Are you sure you want to clear all cached data?')) {
    return;
  }
  
  clearCacheButton.disabled = true;
  
  try {
    await StorageService.clearAllCache();
    await updateStorageInfo();
    showMessage('Cache cleared successfully!', 'success');
  } catch (error: any) {
    showMessage('Failed to clear cache', 'error');
  } finally {
    clearCacheButton.disabled = false;
  }
}

// Update storage info display
async function updateStorageInfo() {
  try {
    const info = await StorageService.getStorageInfo();
    
    const storageUsed = document.getElementById('storageUsed')!;
    const storageQuota = document.getElementById('storageQuota')!;
    const storageBar = document.getElementById('storageBar') as HTMLElement;
    
    // Format sizes
    const usedMB = (info.bytesUsed / 1024 / 1024).toFixed(2);
    const quotaMB = (info.quota / 1024 / 1024).toFixed(0);
    
    storageUsed.textContent = `${usedMB} MB`;
    storageQuota.textContent = `${quotaMB} MB`;
    storageBar.style.width = `${info.percentage}%`;
    
    // Change color based on usage
    if (info.percentage > 80) {
      storageBar.style.background = '#d32f2f';
    } else if (info.percentage > 60) {
      storageBar.style.background = '#f57c00';
    } else {
      storageBar.style.background = '#1a73e8';
    }
  } catch (error) {
    console.error('Failed to update storage info:', error);
  }
}

// Show message
function showMessage(text: string, type: 'success' | 'error' | 'info') {
  messageDiv.textContent = text;
  messageDiv.className = type;
  messageDiv.style.display = 'block';
  
  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 3000);
  }
}
