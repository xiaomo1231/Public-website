/** 手写识别 + 模拟考试作答方式 strings (spread into `en`; kept apart so the main catalog changes stay small). */
export const handwritingEn = {
  'examMode.label': 'How will you answer?',
  'examMode.online': 'Answer on the website',
  'examMode.onlineHint': 'Type your answers; handwritten pages can be added.',
  'examMode.paper': 'Paper (view or print)',
  'examMode.paperHint':
    'Read or print the questions, write on paper, then photograph the pages and assign them to questions.',
  'examMode.tablet': 'Write on the tablet',
  'examMode.tabletHint':
    'A writing area under each question on the paper. Write with a pen; a finger scrolls.',
  'examMode.recognitionNote':
    'Handwriting is recognised only after you submit. You check and confirm every transcript next to your handwriting before anything is graded.',
  'examMode.paperAnswerNote': 'Write this answer on paper. You upload photos after submitting.',
  'examMode.writingAreaFor': 'Writing area for question {number}',
  'examMode.print': 'Print the questions',
  'examMode.submitPaper':
    'After submitting, photograph your pages and assign each to its question. The timer stops now.',
  'examMode.submitTablet':
    'Your writing areas are saved. After submitting you check what was recognised before grading.',

  'writingArea.autosaved': 'Saved automatically',

  'handwritingRecognition.noAI': 'No AI model is configured for online recognition.',
  'handwritingRecognition.visionUnsupported':
    'The configured model cannot read images. Use a vision-capable model, or type the transcript.',
  'handwritingRecognition.invalid':
    'The recognition reply could not be read. Try again, or type the transcript.',
  'handwritingRecognition.localUnavailable':
    'On-device recognition is not available yet (no suitable model is installed). Type the transcript.',
  'handwritingRecognition.confirmFirst':
    'Confirm the transcript of {count} handwritten answer(s) before grading.',
  'handwritingRecognition.imagesLocked':
    'Handwriting can no longer be changed in this attempt (the paper has been submitted).',
  'handwritingRecognition.noService':
    'Recognition is not ready yet. Reload the page and try again.',
  'handwritingRecognition.notSubmitted':
    'Handwriting is recognised only after the paper is submitted (and, on paper, after the upload).',
  'handwritingRecognition.resolveUnclear':
    'Replace or delete every [?] before confirming: only you can decide what you wrote.',
  'handwritingRecognition.noImages': 'This question has no handwriting in this attempt.',
  'handwritingRecognition.blank': 'Nothing legible was found. Type the answer if you wrote one.',
  'handwritingRecognition.typedReason.local-unavailable':
    'On-device recognition is not available. Type what you wrote, looking at your handwriting.',
  'handwritingRecognition.typedReason.online-unavailable':
    'Online recognition is not available (no AI configured, or offline). Type what you wrote.',
  'handwritingRecognition.typedReason.none-available':
    'No recogniser is available offline. Type what you wrote, looking at your handwriting.',
  'handwritingRecognition.typedReason.all-failed':
    'The recognisers could not read these images. Type what you wrote.',

  'settings.handwriting.title': 'Handwriting recognition',
  'settings.handwriting.description':
    'How handwritten mock exam answers (photos or tablet writing) are turned into text.',
  'settings.handwriting.mode': 'Recognition mode',
  'settings.handwriting.auto': 'Automatic',
  'settings.handwriting.autoHint': 'Online when available, otherwise on this device.',
  'settings.handwriting.local': 'This device only',
  'settings.handwriting.localHint':
    'Nothing is sent anywhere. Without an on-device model you type.',
  'settings.handwriting.online': 'Online only',
  'settings.handwriting.onlineHint':
    'Your configured AI model reads the images (it must support images).',
  'settings.handwriting.localStatus':
    'On-device recognition: not available yet. No model we found is both licensed for commercial use and accurate enough on handwritten maths; until one is, offline means typing the transcript.',
  'settings.handwriting.confirmNote':
    'Whatever the mode, you confirm every transcript next to your handwriting before grading.',

  'paperUpload.title': 'Upload your answer pages',
  'paperUpload.description':
    'Photograph each page. Drag a box around an answer (or use the whole page) and give it to its question. Saved regions are kept; page photos are not stored.',
  'paperUpload.addPages': 'Add page photos',
  'paperUpload.pages': 'Pages',
  'paperUpload.pageN': 'Page {n}',
  'paperUpload.pageAlt': 'Photo of answer page {n}',
  'paperUpload.dragHint': 'Drag on the photo to select one answer.',
  'paperUpload.question': 'Question',
  'paperUpload.assignRegion': 'Give the selection to this question',
  'paperUpload.assignPage': 'Give the whole page to this question',
  'paperUpload.noPages': 'No pages yet. Add photos of your answer pages.',
  'paperUpload.assigned': 'Assigned',
  'paperUpload.regions': '{count} region(s)',
  'paperUpload.none': 'none',
  'paperUpload.removeRegion': 'Remove region {n} of question {number}',
  'paperUpload.unassignedNote':
    '{count} question(s) have nothing assigned; they count as unanswered.',
  'paperUpload.done': 'Upload done, recognise',

  'transcript.title': 'Check what was recognised',
  'transcript.description':
    'Compare each transcript with your handwriting, correct it, then confirm. Only the confirmed text is graded, so a misread can never cost you marks. Maths is LaTeX ($x^2$).',
  'transcript.remaining': '{count} of {total} still to confirm',
  'transcript.allConfirmed': 'All transcripts confirmed.',
  'transcript.confirmed': 'Confirmed',
  'transcript.needsConfirm': 'Not confirmed',
  'transcript.provider.online': 'Online recognition',
  'transcript.provider.local': 'On-device recognition',
  'transcript.provider.typed': 'Typed by you',
  'transcript.notYet': 'Not recognised yet.',
  'transcript.textLabel': 'What you wrote (edit if anything differs)',
  'transcript.placeholder': 'Type exactly what you wrote. Maths as LaTeX, e.g. $\\frac{1}{2}x^2$.',
  'transcript.unclear': '{count} unclear part(s) marked [?]',
  'transcript.nextUnclear': 'Go to next [?]',
  'transcript.acceptGuesses': 'Use the {count} suggested reading(s)',
  'transcript.lowConfidence': 'These lines may be misread; check them against your handwriting:',
  'transcript.preview': 'Preview',
  'transcript.confirm': 'Confirm',
  'transcript.reconfirm': 'Confirm changes',
  'transcript.recognize': 'Recognise',
  'transcript.recognizeAgain': 'Recognise again',
  'transcript.resolveFirst': 'Resolve every [?] first.',
  'transcript.recognizing': 'Recognised {done} / {total}',
  'transcript.recognizingStart': 'Recognising handwriting…',
  'transcript.gradeAfterConfirm': 'Confirm {count} more to start grading.',
  'transcript.startGrading': 'Start grading',
  'transcript.enlarge': 'Enlarge page {n} of question {number}',
  'transcript.originalAlt': 'Your handwriting for question {number}, page {n}',
  'transcript.originalTitle': 'Your handwriting, question {number}',
}
