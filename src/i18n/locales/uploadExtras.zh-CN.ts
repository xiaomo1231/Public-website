import type { uploadExtrasEn } from './uploadExtras.en'

/** 上传重复文件可选（2u）与考卷照片合并（2s）(spread into `zhCN`). */
export const uploadExtrasZhCN: Record<keyof typeof uploadExtrasEn, string> = {
  'batch.duplicate.skip': '跳过',
  'batch.duplicate.replace': '覆盖',
  'batch.duplicate.keep': '保留两份',
  'batch.duplicate.choiceLabel': '如何处理 {name}',
  'batch.duplicate.allSkip': '全部跳过',
  'batch.duplicate.allReplace': '全部覆盖',
  'batch.duplicate.notice': '有 {count} 个文件已在这门课中。可跳过、覆盖原文件或保留两份。',
  'batch.duplicate.replaceHint':
    '覆盖会保留原文件的名字、文件夹和考试选择，并重新处理；原文件上有你的作业记录时不覆盖，改为另存一份。',
  'batch.duplicate.willReplace': '将覆盖原文件',
  'batch.duplicate.willKeep': '将另存为 {name}',
  'batch.duplicate.replaced': '已覆盖原文件',
  'batch.duplicate.keptBoth': '已另存为 {name}',
  'batch.duplicate.fallback': '未覆盖：原文件上有你的作业记录，已另存为 {name}',
  'batch.duplicate.replaceBlocked': '原文件上有你的作业记录（作答、保存的问答等），不能覆盖。',
  'batch.duplicate.inQueue': '与上面的文件相同',
  'batch.merge.toggle': '合并成一份试卷',
  'batch.merge.notice': '{count} 张照片：{name}',
  'batch.merge.order': '按编号排页：{from}–{to}',
  'batch.merge.hint': '在本机合成一个 PDF，每张照片一页，每页照常按图片识别。',
  'batch.merge.mergedFrom': '由 {count} 张照片合并',
  'batch.stage.merging': '正在合并照片…',
  'fileBatch.action.mergePhotos': '合并为一份试卷',
  'fileBatch.mergeHint':
    '所选照片按编号合成一个 PDF（每张一页），照常按图片识别；放在第一张照片所在的文件夹，并沿用它们的考试选择。',
  'fileBatch.merge.name': '文件名',
  'fileBatch.merge.deleteOriginals': '合并后删除原照片',
  'fileBatch.merge.deleteOriginalsHint': '有你的作业记录的照片会保留。',
  'fileBatch.merge.needPhotos': '请选择同一门课的至少 2 张照片再合并。',
  'fileBatch.merge.keptHasWork': '已保留：上面有你的作业记录',
  'fileBatch.merge.created': '已生成 {name}。',
}
