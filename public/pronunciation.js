document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-speak]')
  if (!button || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(button.dataset.speak)
  utterance.lang = button.dataset.language || ''
  window.speechSynthesis.speak(utterance)
})
