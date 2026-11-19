function isCorrect(question, answer) {
  if (answer === undefined || answer === null) return false;
  if (question.type === 'single') return answer === question.answer;
  if (['multi', 'diff', 'tabletop'].includes(question.type)) {
    return Array.isArray(answer) && answer.length === question.answer.length &&
      question.answer.every(value => answer.includes(value));
  }
  if (question.type === 'order') {
    return Array.isArray(answer) && answer.length === question.options.length &&
      answer.every((rank, index) => rank === question.answer.indexOf(index) + 1);
  }
  if (question.type === 'match') {
    return Array.isArray(answer) && answer.length === question.answer.length &&
      answer.every((value, index) => value === question.answer[index]);
  }
  if (question.type === 'branch') {
    if (!Array.isArray(answer) || answer.length !== 3) return false;
    let nodeId = 's1';
    for (const step of answer) {
      const node = question.nodes.find(candidate => candidate.id === nodeId);
      if (!node || step?.node !== nodeId || !Number.isInteger(step.choice) || step.choice < 0 || step.choice >= node.options.length || node.answer !== step.choice) return false;
      nodeId = node.options[step.choice].next;
    }
    return nodeId === 'END';
  }
  if (['written', 'correction'].includes(question.type)) {
    const text = String(answer).toLowerCase();
    return (question.keywords || []).every(keyword => text.includes(keyword));
  }
  return false;
}

function answerText(question, answer) {
  if (answer === undefined || answer === null) return 'Not answered';
  if (['written', 'correction'].includes(question.type)) return String(answer);
  if (question.type === 'branch') return Array.isArray(answer) ? answer.map((step, index) => {
    const node = question.nodes.find(candidate => candidate.id === step?.node);
    return `Decision ${index + 1}: ${node?.options?.[step?.choice]?.text || ''}`;
  }).join(' | ') : 'Invalid response';
  if (['multi', 'diff', 'tabletop'].includes(question.type)) return Array.isArray(answer) ? answer.map(index => question.options[index] ?? 'Invalid choice').join(' | ') : 'Invalid response';
  if (question.type === 'order') return Array.isArray(answer) ? answer.map((rank, index) => ({ rank, text: question.options[index] ?? 'Invalid step' })).sort((a, b) => a.rank - b.rank).map(item => `${item.rank}. ${item.text}`).join(' | ') : 'Invalid response';
  if (question.type === 'match') return Array.isArray(answer) ? question.left.map((item, index) => `${item} -> ${question.right[answer[index]] ?? 'Invalid match'}`).join(' | ') : 'Invalid response';
  return question.options?.[answer] ?? 'Not answered';
}

function correctAnswerText(question) {
  if (['written', 'correction'].includes(question.type)) return question.sample || '';
  if (question.type === 'branch') return question.nodes.map(node => `${node.id}: ${node.options[node.answer].text}`).join(' | ');
  if (['multi', 'diff', 'tabletop'].includes(question.type)) return question.answer.map(index => question.options[index]).join(' | ');
  if (question.type === 'order') return question.answer.map(index => question.options[index]).join(' -> ');
  if (question.type === 'match') return question.left.map((item, index) => `${item} -> ${question.right[question.answer[index]]}`).join(' | ');
  return question.options?.[question.answer] || '';
}

export function gradeSubmission(record, pool) {
  const questions = new Map(pool.questions.map(question => [String(question.id), question]));
  let score = 0;
  const responses = [];
  for (let index = 0; index < record.responses.length; index++) {
    const response = record.responses[index];
    const question = questions.get(String(response.questionId));
    if (!question) return null;
    let answer;
    try { answer = response.answerRaw === '' ? undefined : JSON.parse(response.answerRaw); }
    catch { return null; }
    const correct = isCorrect(question, answer);
    if (correct) score++;
    responses.push({
      questionNumber: index + 1,
      questionId: question.id,
      topic: question.topic,
      type: question.type,
      prompt: question.prompt,
      candidateAnswer: answerText(question, answer),
      correctAnswer: correctAnswerText(question),
      correct,
      explanation: question.explanation,
      answerRaw: response.answerRaw,
      writtenNeedsReview: question.type === 'written' || question.type === 'correction',
    });
  }
  return { score, responses };
}
