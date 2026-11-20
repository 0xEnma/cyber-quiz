(() => {
  const labels = {
    single: 'Single choice', multi: 'Multiple choice', branch: 'Branching scenario',
    order: 'Ordering', match: 'Matching columns', diff: 'Spot the difference',
    tabletop: 'Tabletop exercise', correction: 'Error correction', written: 'Short written response',
    confidence: 'Confidence-based', redFlags: 'Identify red flags',
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const pretty = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const option = (question, index) => question.options?.[index] ?? `Option ${Number(index) + 1}`;

  function answerKey(question) {
    if (question.type === 'branch') {
      return (question.nodes || []).map(node => `${node.prompt}: ${node.options?.[node.answer]?.text || `Option ${Number(node.answer) + 1}`}`).join('\n');
    }
    if (question.type === 'match') {
      return (question.left || []).map((left, index) => `${left} → ${question.right?.[question.answer?.[index]] ?? 'Unspecified'}`).join('\n');
    }
    if (question.type === 'order' && Array.isArray(question.answer)) return question.answer.map((index, position) => `${position + 1}. ${option(question, index)}`).join('\n');
    if (['single', 'multi', 'diff', 'tabletop'].includes(question.type)) {
      const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
      return answers.map(index => option(question, index)).join('\n');
    }
    const subjective = question.answer ?? question.sample ?? question.keywords;
    return subjective === undefined ? 'Manual evaluation required; no answer key supplied.' : pretty(subjective);
  }

  function questionCard(question, index, overallIndex) {
    const type = question.type || 'unknown';
    const keys = type === 'branch' ? [] : (Array.isArray(question.answer) ? question.answer : [question.answer]);
    const options = Array.isArray(question.options) ? `<ol class="pool-preview-options" type="A">${question.options.map((item, optionIndex) => {
      const isCorrect = keys.includes(optionIndex);
      return `<li class="${isCorrect ? 'is-answer' : ''}">${escapeHtml(item)}${isCorrect ? ' <strong>(answer)</strong>' : ''}</li>`;
    }).join('')}</ol>` : '';
    const pairs = type === 'match' ? `<div class="pool-preview-extra"><strong>Left column</strong><ol>${(question.left || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol><strong>Right column</strong><ol>${(question.right || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div>` : '';
    const branch = type === 'branch' ? `<div class="pool-preview-extra">${(question.nodes || []).map(node => `<p><strong>${escapeHtml(node.prompt)}</strong><br>Correct choice: ${escapeHtml(node.options?.[node.answer]?.text || `Option ${Number(node.answer) + 1}`)}</p>`).join('')}</div>` : '';
    const evidence = type === 'diff' && question.evidence ? `<details class="pool-preview-extra"><summary>Scenario evidence</summary><pre>${escapeHtml(pretty(question.evidence))}</pre></details>` : '';
    return `<article class="pool-question"><div class="pool-question-meta">${escapeHtml(labels[type] || type)} · Question ${index} · Overall #${overallIndex} · ID ${escapeHtml(question.id)}</div><h3>${escapeHtml(question.prompt)}</h3>${pairs}${branch}${evidence}${options}<div class="pool-answer"><strong>Answer key</strong><pre>${escapeHtml(answerKey(question))}</pre></div>${question.explanation ? `<p class="pool-explanation"><strong>Explanation:</strong> ${escapeHtml(question.explanation)}</p>` : ''}</article>`;
  }

  function ensureDialog() {
    let dialog = document.getElementById('pool-management-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'pool-management-dialog';
    dialog.className = 'pool-management-dialog';
    dialog.innerHTML = '<div class="pool-management-head"><div><div class="kicker">Question pool</div><h2 id="pool-dialog-title"></h2></div><button class="review-close" type="button" data-close-pool-dialog>Close</button></div><p id="pool-dialog-status" class="tiny" aria-live="polite"></p><div id="pool-dialog-content"></div>';
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target.matches('[data-close-pool-dialog]') || event.target === dialog) dialog.close();
    });
    return dialog;
  }

  async function getPool(id) {
    const response = await fetch(`/api/pools?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const pool = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(pool.error || 'Could not load this question pool.');
    return pool;
  }

  async function previewPool(id) {
    const dialog = ensureDialog();
    const title = dialog.querySelector('#pool-dialog-title');
    const content = dialog.querySelector('#pool-dialog-content');
    const status = dialog.querySelector('#pool-dialog-status');
    title.textContent = 'Loading question pool…'; content.innerHTML = ''; status.textContent = '';
    dialog.showModal();
    try {
      const pool = await getPool(id);
      title.textContent = `${pool.name} · ${pool.questions.length} questions`;
      const grouped = new Map();
      pool.questions.forEach((question, index) => {
        const type = question.type || 'unknown';
        if (!grouped.has(type)) grouped.set(type, []);
        grouped.get(type).push({ question, index });
      });
      content.innerHTML = [...grouped].map(([type, entries], groupIndex) => `<details class="pool-preview-group"${groupIndex === 0 ? ' open' : ''}><summary><strong>${escapeHtml(labels[type] || type)}</strong> <span>(${entries.length} questions)</span></summary><div class="pool-preview-questions">${entries.map(({ question, index }, position) => questionCard(question, position + 1, index + 1)).join('')}</div></details>`).join('');
    } catch (error) { title.textContent = 'Question pool preview'; status.textContent = error.message; }
  }

  async function editPool(id) {
    const dialog = ensureDialog();
    const title = dialog.querySelector('#pool-dialog-title');
    const content = dialog.querySelector('#pool-dialog-content');
    const status = dialog.querySelector('#pool-dialog-status');
    title.textContent = 'Loading question pool…'; content.innerHTML = ''; status.textContent = '';
    dialog.showModal();
    try {
      const pool = await getPool(id);
      title.textContent = `Edit ${pool.name}`;
      content.innerHTML = `<p class="muted">Update the pool JSON and save. Existing links assigned to this pool will use the updated questions when opened. Validate the JSON before saving.</p><form id="pool-json-edit-form"><textarea id="pool-json-editor" spellcheck="false" aria-label="Question pool JSON"></textarea><div class="pool-edit-actions"><button class="btn primary" type="submit">Validate and save</button></div></form>`;
      content.querySelector('#pool-json-editor').value = JSON.stringify(pool, null, 2);
      content.querySelector('#pool-json-edit-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('[type="submit"]');
        button.disabled = true; status.textContent = 'Validating and saving…';
        try {
          const value = JSON.parse(content.querySelector('#pool-json-editor').value);
          delete value.id;
          const response = await fetch(`/api/pools?id=${encodeURIComponent(id)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error([result.error, ...(result.details || [])].filter(Boolean).join(' '));
          status.textContent = 'Question pool saved.';
          status.style.color = '#167b52';
          await window.refreshPools?.();
        } catch (error) {
          status.textContent = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message;
          status.style.color = '#a3363f';
        } finally { button.disabled = false; }
      });
    } catch (error) { title.textContent = 'Edit question pool'; status.textContent = error.message; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('saved-pools')?.addEventListener('click', event => {
      const preview = event.target.closest('[data-preview-pool]');
      const edit = event.target.closest('[data-edit-pool]');
      if (preview) previewPool(preview.dataset.previewPool);
      if (edit) editPool(edit.dataset.editPool);
    });
    const style = document.createElement('style');
    style.textContent = `
      .pool-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .pool-management-dialog{width:min(900px,calc(100vw - 28px));max-height:88vh;overflow:auto;border:1px solid #dce5ed;border-radius:16px;padding:22px;background:#fff;color:#1b2e42;box-shadow:0 20px 60px #10294333}
      .pool-management-dialog::backdrop{background:#10294388}
      .pool-management-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;position:sticky;top:-22px;padding:12px 0;background:#fff;border-bottom:1px solid #e6edf2;z-index:1}
      .pool-management-head h2{margin:4px 0;font-size:21px}
      .pool-preview-group{margin:14px 0;border:1px solid #dce5ed;border-radius:10px;overflow:hidden}.pool-preview-group>summary{padding:12px 14px;background:#f2f7f9;color:#087e8b;cursor:pointer;user-select:none}.pool-preview-group>summary::marker{color:#087e8b}.pool-preview-group>summary span{color:#64788b;font-size:12px}.pool-preview-questions{padding:0 12px}
      .pool-question{margin:12px 0;padding:16px;border:1px solid #dce5ed;border-radius:12px;background:#fbfcfe}
      .pool-question-meta{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64788b}
      .pool-question h3{font-size:15px;margin:8px 0 10px;white-space:pre-wrap}
      .pool-preview-options{padding-left:30px}.pool-preview-options li{padding:4px 8px}.pool-preview-options .is-answer{background:#eaf7f0;color:#176a47;border-radius:6px}
      .pool-answer{margin-top:12px;padding:10px 12px;border-left:3px solid #087e8b;background:#edf7f8}.pool-answer pre,.pool-preview-extra pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0 0}
      .pool-preview-extra{padding:8px 12px;background:#f2f5f8;border-radius:8px}.pool-preview-extra ol{margin-top:5px}.pool-explanation{font-size:12px;color:#52677b}
      #pool-json-edit-form{display:grid;gap:12px}#pool-json-editor{width:100%;min-height:55vh;padding:12px;border:1px solid #cddae4;border-radius:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;tab-size:2}
      .pool-edit-actions{display:flex;justify-content:flex-end}@media(max-width:560px){.pool-summary{align-items:flex-start;flex-direction:column}.pool-actions{justify-content:flex-start}.pool-management-dialog{padding:16px}}
    `;
    document.head.append(style);
  });
})();
