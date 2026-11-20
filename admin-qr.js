document.addEventListener('DOMContentLoaded', () => {
  const links = document.getElementById('generated-tests');
  if (!links) return;

  links.addEventListener('click', async event => {
    const button = event.target.closest('[data-download-test-qr]');
    if (!button) return;

    button.disabled = true;
    try {
      const response = await fetch('/api/tests/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: button.dataset.downloadTestQr }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Could not generate the QR code.');
      }

      const image = await response.blob();
      const downloadUrl = URL.createObjectURL(image);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = 'bankshield-test-qr.png';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      const status = document.getElementById('test-create-status');
      if (status) status.textContent = 'QR code downloaded.';
    } catch (error) {
      const status = document.getElementById('test-create-status');
      if (status) status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
});
