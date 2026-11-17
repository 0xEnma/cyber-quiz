(() => {
  const UI = () => window.__HINDI_UI || {};
  const EXTRA = {
    setupKicker: 'शुरू करने से पहले',
    coverageKicker: 'मूल्यांकन कवरेज',
    topicsCount: '10 विषय',
    heroEyebrow: 'ग्राहकों की सुरक्षा करें। प्रक्रिया का पालन करें। समय रहते रिपोर्ट करें।',
    messageA: 'संदेश A',
    messageB: 'संदेश B',
    trainingExample: 'प्रशिक्षण उदाहरण',
    evidenceDetails: 'संदेश या परिस्थिति का विवरण',
    decision: 'निर्णय',
    fontIncrease: 'फ़ॉन्ट आकार बढ़ाएँ',
    fontDecrease: 'फ़ॉन्ट आकार घटाएँ',
    fontReset: 'फ़ॉन्ट आकार सामान्य करें',
    evidenceFields: { title: 'शीर्षक', from: 'प्रेषक', link: 'लिंक', request: 'अनुरोध', tone: 'लहजा', 'reply-to': 'जवाब का पता' }
  };
  let language = 'en';
  const text = (key, english) => language === 'hi' ? (UI()[key] || EXTRA[key] || english) : english;

  function localizeQuestion(question) {
    if (language !== 'hi') return question;
    const hi = (window.__HINDI_MAP || {})[question.id];
    if (!hi) return question;
    const q = { ...question };
    if (hi.topic_hi) q.topic = hi.topic_hi;
    if (hi.formatLabel_hi) q.formatLabel = hi.formatLabel_hi;
    if (hi.prompt_hi) q.prompt = hi.prompt_hi;
    if (hi.explanation_hi) q.explanation = hi.explanation_hi;
    if (Array.isArray(hi.options_hi)) q.options = hi.options_hi;
    if (Array.isArray(hi.left_hi)) q.left = hi.left_hi;
    if (Array.isArray(hi.right_hi)) q.right = hi.right_hi;
    if (hi.evidence_hi && q.evidence) q.evidence = hi.evidence_hi;
    if (Array.isArray(hi.nodes_hi) && q.nodes) {
      q.nodes = q.nodes.map(node => {
        const translated = hi.nodes_hi.find(item => item.id === node.id);
        if (!translated) return node;
        return {
          ...node,
          prompt: translated.prompt_hi || node.prompt,
          options: node.options.map((option, index) => ({
            ...option,
            text: translated.options_hi?.[index]?.text_hi || option.text
          }))
        };
      });
    }
    return q;
  }

  function setLanguage(next) {
    language = next === 'hi' ? 'hi' : 'en';
    document.documentElement.lang = language;
    try { localStorage.setItem('bankshield_lang', language); } catch (_) {}
    const isHindi = language === 'hi';
    const button = document.getElementById('lang-toggle');
    if (button) {
      button.textContent = isHindi ? 'English' : 'हिंदी';
      button.setAttribute('aria-label', isHindi ? 'Switch to English' : 'हिंदी में बदलें');
      button.title = isHindi ? 'Switch to English' : 'हिंदी में बदलें';
    }
    const fontButtons = [
      [document.getElementById('font-decrease'), 'fontDecrease', 'Decrease font size'],
      [document.getElementById('font-increase'), 'fontIncrease', 'Increase font size'],
      [document.getElementById('font-reset'), 'fontReset', 'Reset font size']
    ];
    fontButtons.forEach(([el, key, english]) => {
      if (el) { el.title = text(key, english); el.setAttribute('aria-label', text(key, english)); }
    });

    const set = (selector, key, english) => {
      const el = document.querySelector(selector);
      if (el) el.textContent = text(key, english);
    };
    set('.brand small', 'brandTagline', 'Staff security awareness');
    set('.topnote', 'topbarNote', 'Internal employee assessment · Practice scenario');
    set('.hero h1', 'pageIntroTitle', 'Security awareness for front-line banking staff.');
    set('.hero p', 'pageIntroDesc', 'This assessment focuses on everyday decisions made by clerks and customer-facing branch staff: checking identity, protecting customer information, spotting suspicious messages, following compliance steps, and reporting concerns without disturbing evidence.');
    set('.hero .eyebrow', 'heroEyebrow', 'Protect customers. Follow the process. Report early.');
    const pills = document.querySelectorAll('.hero .pill');
    if (pills.length) {
      const settings=window.bankshieldGetQuizSettings?.()||{questionCount:25,timeLimitMinutes:15,maxQuestions:93};
      const values = isHindi ? [`${settings.questionCount} प्रश्न`, `${settings.timeLimitMinutes} मिनट`, 'एक समय में एक प्रश्न', 'वापस नहीं जा सकते', `${settings.maxQuestions} प्रश्नों का पूल`] : [`${settings.questionCount} questions`, `${settings.timeLimitMinutes}-minute limit`, 'One question at a time', 'No going back', `${settings.maxQuestions}-question pool`];
      pills.forEach((el, i) => { if (values[i]) el.textContent = values[i]; });
    }
    set('#setup-view .panel .kicker', 'setupKicker', 'Before you begin');
    set('#setup-view .panel h2', 'setupTitle', 'Enter your details');
    const setupDesc = document.querySelector('#setup-view .panel .muted');
    if (setupDesc) setupDesc.textContent = text('setupDesc', 'All fields are required. Use your work details so the training administrator can identify your submission.');
    const labels = document.querySelectorAll('#profile-form label');
    const labelKeys = ['lblFullName', 'lblDept', 'lblBranch', 'lblEmail'];
    labels.forEach(el => { if (!el.dataset.english) el.dataset.english = el.textContent; });
    labels.forEach((el, i) => { if (labelKeys[i]) el.textContent = text(labelKeys[i], el.dataset.english); });
    const placeholders = [['#full-name','phFullName'],['#department','phDept'],['#branch','phBranch'],['#email','phEmail']];
    placeholders.forEach(([selector,key]) => { const el=document.querySelector(selector); if(el){if(!el.dataset.english)el.dataset.english=el.placeholder;el.placeholder=isHindi?(UI()[key]||el.dataset.english):el.dataset.english;} });
    const foot = document.querySelector('#profile-form .formfoot .micro');
    const settings=window.bankshieldGetQuizSettings?.()||{questionCount:25,timeLimitMinutes:15,maxQuestions:93};
    if (foot) { const copy=text('setupFootNote', 'The assessment lasts 15 minutes. Once you move to the next question, you cannot return to an earlier one. Your score and correct answers will not be shown when you finish.'); foot.textContent=isHindi?copy.replace(/15/g,String(settings.timeLimitMinutes)):copy.replace('15 minutes',`${settings.timeLimitMinutes} minutes`); }
    const start = document.querySelector('#profile-form button[type="submit"]');
    if (start) start.textContent = text('startBtn', 'Start assessment →');
    set('#setup-view aside .sidecard .kicker', 'coverageTitle', 'Assessment coverage');
    set('#setup-view aside .sidecard h2', 'topicsCount', '10 topics');
    const coverageDesc = document.querySelector('#setup-view aside .sidecard .muted');
    if (coverageDesc) coverageDesc.textContent = text('coverageDesc', 'More questions focus on customer privacy, phishing, incident reporting, compliance, and phone scams—situations staff meet more often.');
    const notice = document.querySelector('#setup-view aside .notice');
    if (notice && !notice.dataset.english) notice.dataset.english = notice.innerHTML;
    if (notice) notice.innerHTML = isHindi ? (UI().noticeBox || notice.dataset.english) : notice.dataset.english;
    const footer = document.querySelector('#setup-view .footnote');
    if (footer) footer.textContent = text('footnoteText', 'BankShield pilot · Candidate-facing screen does not display answers or scores.');

    const quizKicker = document.querySelector('#quiz-view .quizhead .kicker');
    if (quizKicker) quizKicker.textContent = text('quizKicker', 'Assessment in progress');
    const quizTitle = document.querySelector('#quiz-view .quizhead h2');
    if (quizTitle) quizTitle.textContent = text('quizTitle', 'Security awareness check');
    const navNote = document.querySelector('#quiz-view .quizhead .micro');
    if (navNote) navNote.textContent = text('navNote', 'Your answer is saved when you select “Continue”. You cannot return to previous questions.');
    const sideTitles = document.querySelectorAll('#quiz-view .sidepad h3');
    sideTitles.forEach(el=>{if(!el.dataset.english)el.dataset.english=el.textContent;});
    ['sideHProgress','sideHTimer','sideHPolicy'].forEach((key,i)=>{ if(sideTitles[i])sideTitles[i].textContent=text(key,sideTitles[i].dataset.english||sideTitles[i].textContent); });
    const sideTexts = document.querySelectorAll('#quiz-view .sidepad p');
    sideTexts.forEach(el=>{if(!el.dataset.english)el.dataset.english=el.textContent;});
    ['sidePProgress','sidePTimer','sidePPolicy'].forEach((key,i)=>{ if(sideTexts[i])sideTexts[i].textContent=text(key,sideTexts[i].dataset.english||sideTexts[i].textContent); });
    if(sideTexts[1])sideTexts[1].textContent=isHindi?sideTexts[1].textContent.replace(/15/g,String(settings.timeLimitMinutes)):sideTexts[1].textContent.replace('15 minutes',`${settings.timeLimitMinutes} minutes`);
    const finish = document.querySelector('#finish-view');
    if (finish) {
      const kicker=finish.querySelector('.kicker'), title=finish.querySelector('h1'), panel=finish.querySelector('.endpanel');
      if(kicker)kicker.textContent=text('finishKicker','Submission recorded');
      if(title)title.textContent=text('finishTitle','Thank you.');
      if(panel)panel.textContent=text('endPanel','You may close this page now. Please do not refresh or reopen the assessment to try to change your answers.');
      const message=finish.querySelector('#finish-message');
      if(message){
        const timedOut=message.dataset.outcome==='timeout';
        const failed=message.dataset.outcome==='error';
        const english=timedOut?'Time is up. Your saved answers have been submitted. Your score and correct answers will not be displayed here.':failed?'Your assessment ended, but this browser could not save the submission. Please contact the administrator before closing this page.':'Your assessment has been recorded. Your score and correct answers will not be displayed here.';
        message.textContent=timedOut?text('finishMsgTimeout',english):failed?text('finishMsgError',english):text('finishMsgSuccess',english);
      }
    }
    const impact=document.getElementById('dpdp-impact');
    if(impact&&!impact.classList.contains('hidden')){
      const count=Number(impact.dataset.wrongCount)||0;
      const amount=Number(impact.dataset.exposureCrore)||0;
      const title=impact.querySelector('#dpdp-impact-title');
      const value=impact.querySelector('#dpdp-impact-value');
      const note=impact.querySelector('#dpdp-impact-note');
      const link=impact.querySelector('a');
      if(title)title.textContent=text('dpdpImpactTitle','DPDP training');
      if(value)value.textContent=amount===0?text('dpdpImpactZero','No incorrect selected answers were recorded, so this training illustration is â‚¹0.'):text('dpdpImpactValue','Under this deliberately severe training assumption, the maximum penalty reaches up to â‚¹{amount} crore, calculated based on {count} incorrect answers.').replace('{count}',String(count)).replace('{amount}',amount.toLocaleString(language==='hi'?'hi-IN':'en-IN'));
      if(note)note.textContent=text('dpdpImpactNote','This is a hypothetical training illustration only. By topic, it uses the Act’s maximum caps: ₹250 crore for security-safeguard failures, ₹200 crore for breach-notice failures, and ₹50 crore for other provisions. It assumes every wrong answer became a separate contravention; a quiz answer itself is not a contravention and no penalty has been imposed. Actual penalties depend on the facts and adjudication. The Act’s main duties and penalty provisions are scheduled to commence on 14 May 2027.');
      if(link)link.textContent=text('dpdpActLink','Read the DPDP Act');
    }    if (typeof renderTopics === 'function') renderTopics();
    if (typeof state !== 'undefined' && state.questions.length && !document.getElementById('quiz-view').classList.contains('hidden')) renderQuestion();
  }

  window.bankshieldLanguage = () => language;
  window.localizeQuestion = localizeQuestion;
  window.bankshieldText = text;
  window.bankshieldEvidenceLabel = key => language === 'hi' ? (EXTRA.evidenceFields[key] || key) : key;
  window.bankshieldSetLanguage = setLanguage;
  window.bankshieldRefreshLanguage = () => setLanguage(language);
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('lang-toggle');
    if (button) button.addEventListener('click', () => setLanguage(language === 'en' ? 'hi' : 'en'));
    const scaleKey = 'bankshield_font_scale';
    let fontScale = 1;
    try { fontScale = Number(localStorage.getItem(scaleKey)) || 1; } catch (_) {}
    const setFontScale = value => {
      fontScale = Math.max(0.8, Math.min(1.5, Math.round(value * 10) / 10));
      document.documentElement.style.setProperty('--font-scale', String(fontScale));
      try { localStorage.setItem(scaleKey, String(fontScale)); } catch (_) {}
      const smaller = document.getElementById('font-decrease');
      const larger = document.getElementById('font-increase');
      if (smaller) smaller.disabled = fontScale <= 0.8;
      if (larger) larger.disabled = fontScale >= 1.5;
    };
    document.getElementById('font-decrease')?.addEventListener('click', () => setFontScale(fontScale - 0.1));
    document.getElementById('font-increase')?.addEventListener('click', () => setFontScale(fontScale + 0.1));
    document.getElementById('font-reset')?.addEventListener('click', () => setFontScale(1));
    setFontScale(fontScale);
    let saved = 'en';
    try { saved = localStorage.getItem('bankshield_lang') || 'en'; } catch (_) {}
    setLanguage(saved);
  });
})();
