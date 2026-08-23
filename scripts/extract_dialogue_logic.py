import re, json
from lxml import html as lxml_html

PATH = '/Users/levi/Downloads/TMUA 逻辑推理专练20题A.html'
raw = open(PATH, encoding='utf-8').read()
tree = lxml_html.fromstring(raw)

def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()

qs_blocks = tree.xpath('//div[contains(@class,"q") and @id]')
print('question blocks:', len(qs_blocks))

questions = []
for li in qs_blocks:
    qid = li.get('id')  # Q1..Q20
    n = int(re.search(r'\d+', qid).group())

    # 标题(含 * 标记)
    ttl = li.xpath('.//div[contains(@class,"q-head")]//span[contains(@class,"ttl")]')
    ttl_txt = norm(''.join(ttl[0].itertext())) if ttl else ''

    # 题干: 多条 speak + 一条 rule
    stem_parts = []
    speaks = li.xpath('.//div[contains(@class,"stem")]//div[contains(@class,"speak")]')
    for sp in speaks:
        stem_parts.append(norm(''.join(sp.itertext())))
    rules = li.xpath('.//div[contains(@class,"stem")]//div[contains(@class,"rule")]')
    for ru in rules:
        stem_parts.append(norm(''.join(ru.itertext())))
    stem_txt = '\n'.join(stem_parts)

    full_stem = (ttl_txt + '\n\n' + stem_txt).strip() if ttl_txt else stem_txt

    # 选项 A-H
    opt_lis = li.xpath('.//ol[contains(@class,"opts")]/li')
    opts = []
    opt_map = {}
    for o in opt_lis:
        lab = o.xpath('.//span[contains(@class,"lab")]/text()')
        ot = o.xpath('.//span[contains(@class,"ot")]')
        letter = norm(lab[0]) if lab else ''
        content = norm(''.join(ot[0].itertext())) if ot else ''
        opts.append(content)
        opt_map[letter] = content

    # 答案 ✅ Answer: X
    ans_h = li.xpath('.//div[contains(@class,"sol-h") and contains(text(),"Answer")]')
    ans_letter = ''
    if ans_h:
        m = re.search(r'Answer:\s*([A-H])', ans_h[0].text or '')
        if m:
            ans_letter = m.group(1)
    answer = opt_map.get(ans_letter, '')
    if not answer:
        print('  !! Q'+str(n)+' answer letter', ans_letter, 'not found in opts')

    # 解析: sol-body 正文 + 后续 distractor 说明
    # 注意: 部分 HTML 中 <div class="dist"> 在 lxml 解析时被划到 sol-body 之外,
    # 因此单独抓取 sol-body 全文 + 所有 distractor 节点再合并。
    sol_body = li.xpath('.//div[contains(@class,"sol-body")]')
    solution = ''
    if sol_body:
        sb = sol_body[0]
        # 正文: sol-body 的直接文本 + 非 distractor 子节点的文本
        body_text = norm(''.join(sb.itertext()))
        body_text = re.sub(r'^Solution(\S)', r'Solution: \1', body_text)
        # distractor 节点(可能在 sol-body 内或外)
        dists = li.xpath('.//div[contains(@class,"sol-body")]//div[contains(@class,"dist")]')
        if not dists:
            dists = li.xpath('.//div[contains(@class,"dist")]')
        dist_lines = []
        for d in dists:
            dt = norm(''.join(d.itertext()))
            dt = re.sub(r'^([A-H])\s*—\s*', r'\1 — ', dt)
            dist_lines.append(dt)
        parts = [body_text]
        if dist_lines:
            parts.append('Why the distractors fail')
            parts.extend(dist_lines)
        solution = '\n'.join(parts).strip()

    questions.append({
        'subject':'数学','paper':'P1','topic':'Logic','topicIds':['Logic'],
        'difficulty':4,'type':'SINGLE_CHOICE','status':'PUBLISHED',
        'source':'TMUA-P1-DIALOGUE-LOGIC-Q'+str(n),'sourceType':'TMUA',
        'stem':full_stem,'options':opts,'answer':answer,'solution':solution,
        'srcNote':'TMUA P1 逻辑推理专练',
    })
    print('Q'+str(n), 'opts='+str(len(opts)), 'ans='+ans_letter, 'sol_len='+str(len(solution)))

paper = {
    'title':'TMUA P1 逻辑推理专练 20 题 A','subject':'数学','sourceType':'TMUA',
    'source':'TMUA-P1-DIALOGUE-LOGIC','origin':'AUTO_SET','kind':'mock','status':'READY',
    'sourceKey':'数学::P1::TMUA-P1-DIALOGUE-LOGIC',
    'questionIds':['__Q'+str(i)+'__' for i in range(len(questions))],
}
json.dump({'paper':paper,'questions':questions},
          open('scripts/bank_tmua_p1_dialogue_logic.json','w',encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('WROTE scripts/bank_tmua_p1_dialogue_logic.json with', len(questions), 'questions')
