// One dashboard tab only: the SQLite OPFS pool allows a single connection.
chrome.action.onClicked.addListener(async () => {
  // getContexts sees this extension's own tabs without needing the "tabs" permission.
  const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }
});
