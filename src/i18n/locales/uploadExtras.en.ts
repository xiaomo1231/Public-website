/** 上传重复文件可选 (2u) and 考卷照片合并 (2s) (spread into `en`). */
export const uploadExtrasEn = {
  'batch.duplicate.skip': 'Skip',
  'batch.duplicate.replace': 'Replace',
  'batch.duplicate.keep': 'Keep both',
  'batch.duplicate.choiceLabel': 'What to do with {name}',
  'batch.duplicate.allSkip': 'Skip all',
  'batch.duplicate.allReplace': 'Replace all',
  'batch.duplicate.notice':
    '{count} files already exist in this course. Skip them, replace the stored file, or keep both.',
  'batch.duplicate.replaceHint':
    'Replace keeps the stored file’s name, folder and exam selections and processes it again. A file with your own work on it is kept, and the new one is saved as a second copy.',
  'batch.duplicate.willReplace': 'Will replace the stored file',
  'batch.duplicate.willKeep': 'Will be saved as {name}',
  'batch.duplicate.replaced': 'Replaced the stored file',
  'batch.duplicate.keptBoth': 'Saved as {name}',
  'batch.duplicate.fallback':
    'Not replaced: the stored file has your work on it. Saved as {name} instead',
  'batch.duplicate.replaceBlocked':
    'This file has your own work on it (answers, saved questions…), so it cannot be replaced.',
  'batch.duplicate.inQueue': 'Same file as one above',
  'batch.merge.toggle': 'Merge into one paper',
  'batch.merge.notice': '{count} photos: {name}',
  'batch.merge.order': 'Pages in number order: {from}–{to}',
  'batch.merge.hint':
    'One PDF is built on this device, one photo per page; each page is read like a photo.',
  'batch.merge.mergedFrom': 'Merged from {count} photos',
  'batch.stage.merging': 'Merging photos…',
  'fileBatch.action.mergePhotos': 'Merge into one paper',
  'fileBatch.mergeHint':
    'The selected photos become one PDF, one photo per page in number order, read like the photos. It keeps the first photo’s folder and the exams they were picked for.',
  'fileBatch.merge.name': 'File name',
  'fileBatch.merge.deleteOriginals': 'Delete the original photos afterwards',
  'fileBatch.merge.deleteOriginalsHint': 'Photos with your own work on them are kept.',
  'fileBatch.merge.needPhotos': 'Select at least 2 photos of one course to merge.',
  'fileBatch.merge.keptHasWork': 'Kept: it has your own work on it',
  'fileBatch.merge.created': 'Created {name}.',
} as const
