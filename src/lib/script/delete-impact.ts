/**
 * 删一份稿子会牵动什么(二十三期)。
 *
 * 稿子不是孤立的: 发布登记挂在它上面(级联删除), 回采作品可能认领了它(校准配对),
 * 内容和选题也可能指向它。**删之前必须把这些说出来** —— 一个「确定删除?」的空
 * 对话框等于没问, 人点确定时并不知道自己在放弃什么。
 *
 * 尤其是校准配对: 攒够 30 条要好几个月, 删掉一份稿子就少一条, 而这件事在稿库
 * 页面上完全看不出来。
 */

export interface DeleteImpact {
  distributions: number;
  /** 回采作品认领了这份稿子 —— 删掉等于毁掉一条校准配对。 */
  linkedWorks: number;
  contents: number;
  topicIdeas: number;
}

/** 有没有任何牵连。没有的话确认文案可以简单点。 */
export function hasImpact(i: DeleteImpact): boolean {
  return i.distributions + i.linkedWorks + i.contents + i.topicIdeas > 0;
}

/**
 * 人话版的后果清单。返回数组而不是拼好的句子 —— 界面要逐条列, 不是塞成一段。
 *
 * 措辞按**严重程度**排: 校准配对最贵(要攒几个月), 发布登记次之(会真的删掉),
 * 内容和选题只是断链接(数据还在)。
 */
export function impactLines(i: DeleteImpact): string[] {
  const lines: string[] = [];
  if (i.linkedWorks > 0) {
    lines.push(`${i.linkedWorks} 条已认领的回采作品会失去关联 —— 校准少 ${i.linkedWorks} 条配对样本`);
  }
  if (i.distributions > 0) {
    lines.push(`${i.distributions} 条发布登记会被一起删掉`);
  }
  if (i.contents > 0) {
    lines.push(`${i.contents} 条内容会断开与这份稿子的链接（内容本身还在）`);
  }
  if (i.topicIdeas > 0) {
    lines.push(`${i.topicIdeas} 条选题会断开链接（选题本身还在）`);
  }
  return lines;
}
