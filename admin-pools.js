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
    if (question.type === 'branch') return (question.nodes || []).map(node => `${node.prompt}: ${node.options?.[node.answer]?.text || `Option ${Number(node.answer) + 1}`}`).join('\n');
    if (question.type === 'match') return (question.left || []).map((left, index) => `${left} -> ${question.right?.[question.answer?.[index]] ?? 'Unspecified'}`).join('\n');
    if (question.type === 'order' && Array.isArray(question.answer)) return question.answer.map((index, position) => `${position + 1}. ${option(question, index)}`).join('\n');
    if (['single', 'multi', 'diff', 'tabletop'].includes(question.type)) {
      const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
      return answers.map(index => option(question, index)).join('\n');
    }
    const subjective = question.answer ?? question.sample ?? question.keywords;
    return subjective === undefined ? 'Manual evaluation required; no answer key supplied.' : pretty(subjective);
  }

  function questionCard(question, index, overallIndex, poolId) {
    const type = question.type || 'unknown';
    const keys = type === 'branch' ? [] : (Array.isArray(question.answer) ? question.answer : [question.answer]);
    const options = Array.isArray(question.options) ? `<ol class="pool-preview-options" type="A">${question.options.map((item, optionIndex) => {
      const isCorrect = keys.includes(optionIndex);
      return `<li class="${isCorrect ? 'is-answer' : ''}">${escapeHtml(item)}${isCorrect ? ' <strong>(answer)</strong>' : ''}</li>`;
    }).join('')}</ol>` : '';
    const pairs = type === 'match' ? `<div class="pool-preview-extra"><strong>Left column</strong><ol>${(question.left || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol><strong>Right column</strong><ol>${(question.right || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div>` : '';
    const branch = type === 'branch' ? `<div class="pool-preview-extra">${(question.nodes || []).map(node => `<p><strong>${escapeHtml(node.prompt)}</strong><br>Correct choice: ${escapeHtml(node.options?.[node.answer]?.text || `Option ${Number(node.answer) + 1}`)}</p>`).join('')}</div>` : '';
    const evidence = type === 'diff' && question.evidence ? `<details class="pool-preview-extra"><summary>Scenario evidence</summary><pre>${escapeHtml(pretty(question.evidence))}</pre></details>` : '';
    return `<article class="pool-question" data-question-id="${escapeHtml(question.id)}" data-pool-id="${escapeHtml(poolId)}"><div class="pool-question-head"><div class="pool-question-meta">${escapeHtml(labels[type] || type)} &middot; Question ${index} &middot; Overall #${overallIndex} &middot; ID ${escapeHtml(question.id)}</div><div class="pool-question-menu-wrap"><button type="button" class="pool-question-menu-toggle" aria-label="Question actions" aria-haspopup="menu" aria-expanded="false">&#8942;</button><div class="pool-question-menu" role="menu" hidden><button type="button" role="menuitem" data-question-action="prompt">Edit question text</button><button type="button" role="menuitem" data-question-action="options">Edit options</button><button type="button" role="menuitem" data-question-action="answer">Edit correct answer</button><button type="button" role="menuitem" class="pool-question-remove" data-question-action="remove">Remove question</button></div></div></div><h3>${escapeHtml(question.prompt)}</h3>${pairs}${branch}${evidence}${options}<div class="pool-answer"><strong>Answer key</strong><pre>${escapeHtml(answerKey(question))}</pre></div>${question.explanation ? `<p class="pool-explanation"><strong>Explanation:</strong> ${escapeHtml(question.explanation)}</p>` : ''}</article>`;
  }

  function ensureDialog() {
    let dialog = document.getElementById('pool-management-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'pool-management-dialog';
    dialog.className = 'pool-management-dialog';
    dialog.innerHTML = '<div class="pool-management-head"><div><div class="kicker">Question pool</div><h2 id="pool-dialog-title"></h2></div><div class="pool-dialog-actions"><button type="button" class="btn danger" data-remove-preview-pool hidden>Remove pool</button><button class="review-close" type="button" data-close-pool-dialog>Close</button></div></div><p id="pool-dialog-status" class="tiny" aria-live="polite"></p><div id="pool-dialog-content"></div>';
    document.body.append(dialog);
    dialog.addEventListener('click', async event => {
      if (event.target.matches('[data-close-pool-dialog]') || event.target === dialog) { dialog.close(); return; }
      const remove = event.target.closest('[data-remove-preview-pool]');
      if (!remove) return;
      const id = remove.dataset.removePreviewPool;
      if (!confirm('Remove this pool from Test Access? Revoke every test link using it first. Existing submissions remain stored.')) return;
      remove.disabled = true;
      const status = dialog.querySelector('#pool-dialog-status');
      try {
        const response = await fetch(`/api/pools?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not remove this pool.');
        dialog.close();
        await window.refreshPools?.();
      } catch (error) { status.textContent = error.message; status.style.color = '#a3363f'; }
      finally { remove.disabled = false; }
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
    title.textContent = 'Loading question pool...'; content.innerHTML = ''; status.textContent = '';
    dialog.dataset.poolId = id;
    const remove = dialog.querySelector('[data-remove-preview-pool]');
    remove.hidden = false; remove.dataset.removePreviewPool = id;
    if (!dialog.open) dialog.showModal();
    try {
      const pool = await getPool(id);
      title.textContent = `${pool.name} - ${pool.questions.length} questions`;
      const grouped = new Map();
      pool.questions.forEach((question, index) => {
        const type = question.type || 'unknown';
        if (!grouped.has(type)) grouped.set(type, []);
        grouped.get(type).push({ question, index });
      });
      content.innerHTML = [...grouped].map(([type, entries], groupIndex) => `<details class="pool-preview-group"${groupIndex === 0 ? ' open' : ''}><summary><strong>${escapeHtml(labels[type] || type)}</strong> <span>(${entries.length} questions)</span></summary><div class="pool-preview-questions">${entries.map(({ question, index }, position) => questionCard(question, position + 1, index + 1, id)).join('')}</div></details>`).join('');
    } catch (error) { title.textContent = 'Question pool preview'; status.textContent = error.message; }
  }

  async function editPool(id) {
    const dialog = ensureDialog();
    const title = dialog.querySelector('#pool-dialog-title');
    const content = dialog.querySelector('#pool-dialog-content');
    const status = dialog.querySelector('#pool-dialog-status');
    title.textContent = 'Loading question pool...'; content.innerHTML = ''; status.textContent = '';
    dialog.querySelector('[data-remove-preview-pool]').hidden = true;
    if (!dialog.open) dialog.showModal();
    try {
      const pool = await getPool(id);
      title.textContent = `Edit ${pool.name}`;
      content.innerHTML = `<p class="muted">Update the pool JSON and save. New test links will use the updated pool. Existing links keep the pool version captured when they were generated. Validate the JSON before saving.</p><form id="pool-json-edit-form"><textarea id="pool-json-editor" spellcheck="false" aria-label="Question pool JSON"></textarea><div class="pool-edit-actions"><button class="btn primary" type="submit">Validate and save</button></div></form>`;
      content.querySelector('#pool-json-editor').value = JSON.stringify(pool, null, 2);
      content.querySelector('#pool-json-edit-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('[type="submit"]');
        button.disabled = true; status.textContent = 'Validating and saving...';
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

  function questionEditor() {
    let dialog = document.getElementById('question-field-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'question-field-dialog';
    dialog.className = 'pool-management-dialog question-field-dialog';
    dialog.innerHTML = '<div class="pool-management-head"><div><div class="kicker">Question editor</div><h2 id="question-field-title"></h2></div><button type="button" class="review-close" data-close-question-editor>Close</button></div><p id="question-field-help" class="muted"></p><p id="question-field-status" class="tiny" aria-live="polite"></p><form id="question-field-form"><div id="question-field-controls"></div><div class="pool-edit-actions"><button type="submit" class="btn primary" disabled>Save change</button></div></form>';
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target.matches('[data-close-question-editor]') || event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function configureQuestionEditor(dialog, pool, question, action) {
    const title = dialog.querySelector('#question-field-title');
    const help = dialog.querySelector('#question-field-help');
    const status = dialog.querySelector('#question-field-status');
    const controls = dialog.querySelector('#question-field-controls');
    const form = dialog.querySelector('#question-field-form');
    const saveButton = form.querySelector('[type="submit"]');
    const type = question.type;
    title.textContent = action === 'prompt' ? 'Edit question text' : action === 'options' ? 'Edit options' : 'Edit correct answer';
    status.textContent = ''; status.style.color = '';
    saveButton.disabled = false;
    let valid = false;
    let selected = null;
    let selectedSet = new Set();
    let branchAnswers = [];
    let order = [];

    const textField = (label, value, name, area = false) => `<label class="question-field-control">${escapeHtml(label)}${area ? `<textarea name="${name}" rows="4">${escapeHtml(value)}</textarea>` : `<input name="${name}" value="${escapeHtml(value)}">`}</label>`;
    const answerChoices = (items, chosen, attribute = 'data-answer-option') => `<div class="answer-choice-list">${items.map((item, index) => `<button type="button" class="answer-choice${chosen(index) ? ' is-selected' : ''}" ${attribute}="${index}" aria-pressed="${chosen(index)}">${escapeHtml(item)}</button>`).join('')}</div>`;
    const setValid = value => { valid = value; saveButton.disabled = !valid; };

    if (action === 'prompt') {
      if (type === 'branch') {
        help.textContent = 'Edit the scenario introduction and each decision question.';
        controls.innerHTML = textField('Scenario introduction', question.prompt, 'prompt', true) + question.nodes.map((node, index) => textField(`Decision question ${index + 1}`, node.prompt, `node-prompt-${index}`, true)).join('');
      } else {
        help.textContent = 'Update the wording shown to the candidate.';
        controls.innerHTML = textField('Question text', question.prompt, 'prompt', true);
      }
      const check = () => setValid([...controls.querySelectorAll('textarea')].every(field => field.value.trim()));
      controls.addEventListener('input', check); check();
    } else if (action === 'options') {
      if (type === 'branch') {
        help.textContent = 'Edit the choice text at each decision point. The branch paths and correct answers stay connected.';
        controls.innerHTML = question.nodes.map((node, nodeIndex) => `<fieldset class="question-choice-fieldset"><legend>Decision ${nodeIndex + 1}: ${escapeHtml(node.prompt)}</legend>${node.options.map((item, optionIndex) => textField(`Choice ${String.fromCharCode(65 + optionIndex)}`, item.text, `branch-${nodeIndex}-${optionIndex}`)).join('')}</fieldset>`).join('');
      } else if (type === 'match') {
        help.textContent = 'Edit the text in each matching column. Keep the same number of items in both columns.';
        controls.innerHTML = '<div class="question-columns"><div><h3>Left column</h3>' + question.left.map((item, index) => textField(`Item ${index + 1}`, item, `left-${index}`)).join('') + '</div><div><h3>Right column</h3>' + question.right.map((item, index) => textField(`Item ${index + 1}`, item, `right-${index}`)).join('') + '</div></div>';
      } else {
        help.textContent = 'Edit the option wording. The answer selection stays attached to the same option.';
        controls.innerHTML = (question.options || []).map((item, index) => textField(`Option ${index + 1}`, item, `option-${index}`)).join('');
      }
      const check = () => setValid([...controls.querySelectorAll('input,textarea')].every(field => field.value.trim()));
      controls.addEventListener('input', check); check();
    } else if (type === 'single') {
      help.textContent = 'The green option is currently correct. Click it again to clear it, or select a different option. Save is disabled until one answer is selected.';
      selected = Number.isInteger(question.answer) ? question.answer : null;
      controls.innerHTML = answerChoices(question.options, index => index === selected);
      controls.addEventListener('click', event => {
        const choice = event.target.closest('[data-answer-option]'); if (!choice) return;
        const index = Number(choice.dataset.answerOption); selected = selected === index ? null : index;
        controls.querySelectorAll('[data-answer-option]').forEach(button => { const active = Number(button.dataset.answerOption) === selected; button.classList.toggle('is-selected', active); button.setAttribute('aria-pressed', String(active)); });
        setValid(selected !== null);
      });
      setValid(selected !== null);
    } else if (['multi', 'diff', 'tabletop'].includes(type)) {
      help.textContent = 'Green options are currently correct. Click to toggle each correct answer. Select at least one answer before saving.';
      selectedSet = new Set(Array.isArray(question.answer) ? question.answer : []);
      controls.innerHTML = answerChoices(question.options, index => selectedSet.has(index));
      controls.addEventListener('click', event => {
        const choice = event.target.closest('[data-answer-option]'); if (!choice) return;
        const index = Number(choice.dataset.answerOption); selectedSet.has(index) ? selectedSet.delete(index) : selectedSet.add(index);
        const active = selectedSet.has(index); choice.classList.toggle('is-selected', active); choice.setAttribute('aria-pressed', String(active)); setValid(selectedSet.size > 0);
      });
      setValid(selectedSet.size > 0);
    } else if (type === 'branch') {
      help.textContent = 'Each decision needs one correct choice. Green shows the current answer; click it again to clear it. Save remains disabled until every decision has an answer.';
      branchAnswers = question.nodes.map(node => Number.isInteger(node.answer) ? node.answer : null);
      controls.innerHTML = question.nodes.map((node, nodeIndex) => `<fieldset class="question-choice-fieldset"><legend>Decision ${nodeIndex + 1}: ${escapeHtml(node.prompt)}</legend>${answerChoices(node.options.map(item => item.text), index => branchAnswers[nodeIndex] === index, `data-branch-choice="${nodeIndex}"`)}</fieldset>`).join('');
      controls.addEventListener('click', event => {
        const choice = event.target.closest('[data-branch-choice]'); if (!choice) return;
        const nodeIndex = Number(choice.dataset.branchChoice), answerIndex = Number(choice.dataset.answerOption);
        branchAnswers[nodeIndex] = branchAnswers[nodeIndex] === answerIndex ? null : answerIndex;
        const fieldset = choice.closest('fieldset');
        fieldset.querySelectorAll('[data-branch-choice]').forEach(button => { const active = Number(button.dataset.answerOption) === branchAnswers[nodeIndex]; button.classList.toggle('is-selected', active); button.setAttribute('aria-pressed', String(active)); });
        setValid(branchAnswers.every(answer => answer !== null));
      });
      setValid(branchAnswers.every(answer => answer !== null));
    } else if (type === 'order') {
      help.textContent = 'Use the arrows to set the correct sequence. Every option must appear once.';
      order = Array.isArray(question.answer) ? [...question.answer] : [];
      const drawOrder = () => {
        controls.innerHTML = `<ol class="answer-order-list">${order.map((optionIndex, position) => `<li><span>${escapeHtml(option(question, optionIndex))}</span><div><button type="button" data-order-move="up" data-order-position="${position}" aria-label="Move up" ${position === 0 ? 'disabled' : ''}>?</button><button type="button" data-order-move="down" data-order-position="${position}" aria-label="Move down" ${position === order.length - 1 ? 'disabled' : ''}>?</button></div></li>`).join('')}</ol>`;
        setValid(order.length === question.options.length && new Set(order).size === question.options.length);
      };
      controls.addEventListener('click', event => {
        const button = event.target.closest('[data-order-move]'); if (!button) return;
        const position = Number(button.dataset.orderPosition), next = position + (button.dataset.orderMove === 'up' ? -1 : 1);
        if (next < 0 || next >= order.length) return;
        [order[position], order[next]] = [order[next], order[position]]; drawOrder();
      });
      drawOrder();
    } else if (type === 'match') {
      help.textContent = 'Choose one right-column match for each left-column item. A right item can be used only once.';
      controls.innerHTML = question.left.map((item, index) => `<label class="question-field-control">${escapeHtml(item)}<select data-match-row="${index}"><option value="">Choose a match</option>${question.right.map((right, rightIndex) => `<option value="${rightIndex}" ${question.answer?.[index] === rightIndex ? 'selected' : ''}>${escapeHtml(right)}</option>`).join('')}</select></label>`).join('');
      const check = () => { const values = [...controls.querySelectorAll('select')].map(select => select.value); setValid(values.every(value => value !== '') && new Set(values).size === values.length); };
      controls.addEventListener('change', check); check();
    } else if (['written', 'correction'].includes(type)) {
      help.textContent = 'Edit the phrases required by automatic evaluation and the sample response shown to the administrator.';
      controls.innerHTML = textField('Required keywords (one per line)', (question.keywords || []).join('\n'), 'keywords', true) + textField('Sample answer', question.sample || '', 'sample', true);
      const check = () => setValid(controls.querySelector('[name="keywords"]').value.split(/\r?\n/).some(value => value.trim()));
      controls.addEventListener('input', check); check();
    } else {
      help.textContent = 'Edit the correct answer value.';
      controls.innerHTML = textField('Correct answer', JSON.stringify(question.answer), 'generic-answer', true);
      const check = () => { try { JSON.parse(controls.querySelector('textarea').value); setValid(true); } catch { setValid(false); } };
      controls.addEventListener('input', check); check();
    }

    form.onsubmit = async event => {
      event.preventDefault();
      if (!valid) return;
      saveButton.disabled = true; status.textContent = 'Saving...';
      try {
        if (action === 'prompt') {
          question.prompt = controls.querySelector('[name="prompt"]').value.trim();
          question.nodes?.forEach((node, index) => { const field = controls.querySelector(`[name="node-prompt-${index}"]`); if (field) node.prompt = field.value.trim(); });
        } else if (action === 'options') {
          if (type === 'branch') question.nodes.forEach((node, nodeIndex) => node.options.forEach((item, optionIndex) => { item.text = controls.querySelector(`[name="branch-${nodeIndex}-${optionIndex}"]`).value.trim(); }));
          else if (type === 'match') {
            question.left = question.left.map((_, index) => controls.querySelector(`[name="left-${index}"]`).value.trim());
            question.right = question.right.map((_, index) => controls.querySelector(`[name="right-${index}"]`).value.trim());
          } else question.options = question.options.map((_, index) => controls.querySelector(`[name="option-${index}"]`).value.trim());
        } else if (type === 'single') question.answer = selected;
        else if (['multi', 'diff', 'tabletop'].includes(type)) question.answer = [...selectedSet].sort((a, b) => a - b);
        else if (type === 'branch') question.nodes.forEach((node, index) => { node.answer = branchAnswers[index]; });
        else if (type === 'order') question.answer = order;
        else if (type === 'match') question.answer = [...controls.querySelectorAll('select')].map(select => Number(select.value));
        else if (['written', 'correction'].includes(type)) {
          question.keywords = controls.querySelector('[name="keywords"]').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
          question.sample = controls.querySelector('[name="sample"]').value.trim();
        } else question.answer = JSON.parse(controls.querySelector('[name="generic-answer"]').value);

        const poolToSave = { ...pool, questions: pool.questions }; delete poolToSave.id;
        const response = await fetch(`/api/pools?id=${encodeURIComponent(pool.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(poolToSave) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error([result.error, ...(result.details || [])].filter(Boolean).join(' '));
        dialog.close(); await window.refreshPools?.();
        const parent = ensureDialog(); if (parent.open) parent.close(); await previewPool(pool.id);
      } catch (error) { status.textContent = error instanceof SyntaxError ? `Invalid answer format: ${error.message}` : error.message; saveButton.disabled = false; }
    };
    if (!dialog.open) dialog.showModal();
  }

  async function saveQuestion(poolId, questionId, action) {
    const pool = await getPool(poolId);
    const question = pool.questions.find(item => String(item.id) === questionId);
    if (!question) throw new Error('Question not found in this pool.');
    if (action === 'remove') {
      if (pool.questions.length <= 5) throw new Error('A pool must contain at least five questions.');
      if (!confirm(`Remove question ${question.id}? Existing links keep the question and answer version captured when they were generated.`)) return;
      pool.questions = pool.questions.filter(item => String(item.id) !== questionId);
      pool.questionCount = Math.min(pool.questionCount, pool.questions.length);
      const response = await fetch(`/api/pools?id=${encodeURIComponent(poolId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pool) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error([result.error, ...(result.details || [])].filter(Boolean).join(' '));
      await window.refreshPools?.();
      const dialog = ensureDialog();
      if (dialog.open) dialog.close();
      await previewPool(poolId);
      return;
    }
    const editor = questionEditor();
    configureQuestionEditor(editor, pool, question, action);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('saved-pools')?.addEventListener('click', event => {
      const preview = event.target.closest('[data-preview-pool]');
      const edit = event.target.closest('[data-edit-pool]');
      if (preview) previewPool(preview.dataset.previewPool);
      if (edit) editPool(edit.dataset.editPool);
    });
    document.body.addEventListener('click', async event => {
      const toggle = event.target.closest('.pool-question-menu-toggle');
      if (toggle) {
        const menu = toggle.parentElement.querySelector('.pool-question-menu');
        document.querySelectorAll('.pool-question-menu').forEach(item => { if (item !== menu) item.hidden = true; });
        menu.hidden = !menu.hidden;
        toggle.setAttribute('aria-expanded', String(!menu.hidden));
        return;
      }
      const action = event.target.closest('[data-question-action]');
      if (action) {
        const card = action.closest('.pool-question');
        action.closest('.pool-question-menu').hidden = true;
        const toggleButton = card.querySelector('.pool-question-menu-toggle');
        toggleButton?.setAttribute('aria-expanded', 'false');
        try { await saveQuestion(card.dataset.poolId, card.dataset.questionId, action.dataset.questionAction); }
        catch (error) { const status = document.querySelector('#pool-dialog-status'); if (status) status.textContent = error.message; }
        return;
      }
      if (!event.target.closest('.pool-question-menu-wrap')) document.querySelectorAll('.pool-question-menu').forEach(menu => { menu.hidden = true; });
    });

    const style = document.createElement('style');
    style.textContent = `
      .pool-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .pool-management-dialog{width:min(900px,calc(100vw - 28px));max-height:88vh;overflow:auto;border:1px solid #dce5ed;border-radius:16px;padding:22px;background:#fff;color:#1b2e42;box-shadow:0 20px 60px #10294333}
      .pool-management-dialog::backdrop{background:#10294388}
      .pool-management-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;position:sticky;top:-22px;padding:12px 0;background:#fff;border-bottom:1px solid #e6edf2;z-index:1}
      .pool-dialog-actions{display:flex;align-items:center;gap:8px}.pool-management-head h2{margin:4px 0;font-size:21px}
      .pool-preview-group{margin:14px 0;border:1px solid #dce5ed;border-radius:10px;overflow:hidden}.pool-preview-group>summary{padding:12px 14px;background:#f2f7f9;color:#087e8b;cursor:pointer;user-select:none}.pool-preview-group>summary::marker{color:#087e8b}.pool-preview-group>summary span{color:#64788b;font-size:12px}.pool-preview-questions{padding:0 12px}
      .pool-question{position:relative;margin:12px 0;padding:16px;border:1px solid #dce5ed;border-radius:12px;background:#fbfcfe}
      .pool-question-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.pool-question-meta{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64788b}
      .pool-question-menu-wrap{position:relative;flex:none}.pool-question-menu-toggle{width:34px;height:34px;border:1px solid #cddae4;border-radius:9px;background:#fff;color:#35516b;font-size:22px;line-height:1}.pool-question-menu-toggle:hover{background:#edf3f7;color:#087e8b}
      .pool-question-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:3;min-width:190px;padding:5px;border:1px solid #dce5ed;border-radius:10px;background:#fff;box-shadow:0 10px 24px #10294324}.pool-question-menu[hidden]{display:none}.pool-question-menu button{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;background:#fff;text-align:left;color:#29445d;font:inherit;font-size:12px}.pool-question-menu button:hover{background:#edf3f7}.pool-question-menu .pool-question-remove{color:#a3363f}
      .pool-question h3{font-size:15px;margin:8px 0 10px;white-space:pre-wrap}
      .pool-preview-options{padding-left:30px}.pool-preview-options li{padding:4px 8px}.pool-preview-options .is-answer{background:#eaf7f0;color:#176a47;border-radius:6px}
      .pool-answer{margin-top:12px;padding:10px 12px;border-left:3px solid #087e8b;background:#edf7f8}.pool-answer pre,.pool-preview-extra pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0 0}
      .pool-preview-extra{padding:8px 12px;background:#f2f5f8;border-radius:8px}.pool-preview-extra ol{margin-top:5px}.pool-explanation{font-size:12px;color:#52677b}
      #pool-json-edit-form,#question-field-form{display:grid;gap:12px}#pool-json-editor{width:100%;min-height:55vh;padding:12px;border:1px solid #cddae4;border-radius:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;tab-size:2}
      #question-field-controls{display:grid;gap:12px}.question-field-control{display:grid;gap:6px;font-size:12px;font-weight:750;color:#32495e}.question-field-control input,.question-field-control textarea,.question-field-control select{width:100%;padding:10px 11px;border:1px solid #cddae4;border-radius:9px;background:#fff;color:#21384e;font:inherit}.question-field-control textarea{min-height:85px;resize:vertical}
      .question-choice-fieldset{display:grid;gap:10px;margin:8px 0;padding:12px;border:1px solid #dce5ed;border-radius:10px}.question-choice-fieldset legend{padding:0 5px;font-size:13px;font-weight:800;color:#29445d}.answer-choice-list{display:grid;gap:8px}.answer-choice{width:100%;padding:11px 13px;border:1px solid #cddae4;border-radius:9px;background:#fff;color:#29445d;text-align:left;white-space:pre-wrap;font:inherit;cursor:pointer}.answer-choice:hover{border-color:#087e8b;background:#f3fafb}.answer-choice.is-selected{border-color:#177850;background:#e6f6eb;color:#176a47;box-shadow:0 0 0 2px #17785024}.answer-choice:focus-visible{outline:3px solid #087e8b55;outline-offset:2px}
      .question-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.question-columns h3{font-size:14px}.answer-order-list{display:grid;gap:8px;padding-left:28px}.answer-order-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid #dce5ed;border-radius:8px;background:#fff}.answer-order-list button{min-width:32px;min-height:30px;margin-left:4px;border:1px solid #cddae4;border-radius:6px;background:#f5f8fa;color:#29445d}.answer-order-list button:disabled{opacity:.4}@media(max-width:560px){.question-columns{grid-template-columns:1fr}}
      .pool-edit-actions{display:flex;justify-content:flex-end}@media(max-width:560px){.pool-summary{align-items:flex-start;flex-direction:column}.pool-actions{justify-content:flex-start}.pool-management-dialog{padding:16px}.pool-question{padding:12px}}
    `;
    document.head.append(style);
  });
})();
