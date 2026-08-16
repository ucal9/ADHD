document.getElementById('toggle-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'INS_READER_TOGGLE_PANEL' });
    window.close();
  } catch (e) {
    document.getElementById('unsupported-hint').style.display = 'block';
  }
});
