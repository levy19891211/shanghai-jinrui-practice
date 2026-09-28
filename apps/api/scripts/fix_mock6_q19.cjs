// Fix TMUA Paper 1 模考6 Q19 (local dev.db):
//  - clarify the stopping rule in the stem (remove ambiguity)
//  - reduce options from 6 to 5 (A-E)
//  - correct topic to M7 (probability), drop irrelevant MM2
//  - keep answer 1/3 and the correct solution
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const PAPER_ID = 'cmt59y9j2000k11xpmi4vu0ht';

const NEW_STEM = "In a game, a player succeeds on each trial with probability $p$ (independent trials). The game ends as soon as the player succeeds. The probability that the game lasts at most $3$ trials is $\\dfrac{19}{27}$. Find $p$.";
const NEW_OPTIONS = JSON.stringify(["$\\frac{1}{3}$", "$\\frac{2}{3}$", "$\\frac{1}{2}$", "$\\frac{1}{9}$", "$\\frac{4}{9}$"]);
const NEW_ANSWER = "$\\frac{1}{3}$";
const NEW_TOPIC = "M7";
const NEW_TOPICIDS = JSON.stringify(["M7"]);
const NEW_SOLUTION = "The game ends at the first success. It lasts at most $3$ trials if the first success occurs on trial $1$, $2$, or $3$. Those probabilities are $p$, $(1-p)p$, and $(1-p)^{2}p$. Their sum is $p\\big(1+(1-p)+(1-p)^{2}\\big)=\\dfrac{19}{27}$. Let $q=1-p$. Then the sum is $(1-q)(1+q+q^{2})=1-q^{3}=\\dfrac{19}{27}$, so $q^{3}=\\dfrac{8}{27}$ and $q=\\dfrac{2}{3}$. Hence $p=1-q=\\dfrac{1}{3}$.";

(async () => {
  const paper = await p.paper.findUnique({ where: { id: PAPER_ID } });
  let ids = []; try { ids = JSON.parse(paper.questionIds || '[]'); } catch {}
  const q19id = ids[18];
  if (!q19id) { console.log('NO_Q19'); await p.$disconnect(); return; }
  const before = await p.question.findUnique({ where: { id: q19id } });
  console.log('BEFORE options len:', JSON.parse(before.options).length, '| topic:', before.topic, '| topicIds:', before.topicIds);
  const updated = await p.question.update({
    where: { id: q19id },
    data: {
      stem: NEW_STEM,
      options: NEW_OPTIONS,
      answer: NEW_ANSWER,
      solution: NEW_SOLUTION,
      topic: NEW_TOPIC,
      topicIds: NEW_TOPICIDS,
    },
  });
  console.log('UPDATED ok. id=', updated.id);
  console.log('AFTER options:', updated.options, '| topic:', updated.topic, '| topicIds:', updated.topicIds, '| answer:', updated.answer);
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
