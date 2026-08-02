import type {
  PracticeCard,
  CheckResult,
  DailyPracticePlan,
  DailyPracticeItem,
  GoalProgress,
  GoalStatus,
  TrainingRoute,
  RouteRunRecord,
  RouteStepCard,
  RouteSummary,
  RouteSortBy
} from './types';
import {
  MAX_RECOMMENDED_DURATION,
  HIGH_PRACTICE_THRESHOLD_DAYS,
  HIGH_PRACTICE_COUNT,
  GOAL_NEAR_DUE_DAYS,
  FAMILIARITY_LABELS,
  getFamiliarityIndex
} from './types';
import { generateId } from './storage';

export function formatDate(ts: number | undefined): string {
  if (!ts) return '从未';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '从未';
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function daysBetween(a: number, b: number): number {
  const ms = Math.abs(a - b);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export function countRecentPractices(history: number[], days: number): number {
  if (!history || history.length === 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] >= cutoff) count++;
    else break;
  }
  return count;
}

export function runChecks(cards: PracticeCard[]): CheckResult[] {
  const results: CheckResult[] = [];

  for (const card of cards) {
    if (card.durationMinutes > MAX_RECOMMENDED_DURATION) {
      results.push({
        id: generateId(),
        severity: 'warning',
        rule: 'DURATION_TOO_LONG',
        message: `条目「${card.title}」建议时长 ${card.durationMinutes} 分钟，超过推荐上限 ${MAX_RECOMMENDED_DURATION} 分钟，建议拆成更短的讲解段落`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.familiarity === 'mastered' && card.errorPoints.length === 0) {
      results.push({
        id: generateId(),
        severity: 'info',
        rule: 'EMPTY_ERROR_POINTS_MASTERED',
        message: `条目「${card.title}」标记为已掌握但易错点为空，建议确认是否真的无易错项`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.alternatives.length === 0 && card.familiarity !== 'mastered') {
      results.push({
        id: generateId(),
        severity: 'warning',
        rule: 'MISSING_ALTERNATIVES',
        message: `条目「${card.title}」缺少替代表达，建议补充以备现场节奏变化`,
        cardId: card.id,
        cardTitle: card.title
      });
    }

    if (card.lastPracticedAt) {
      const recentCount = countRecentPractices(card.practiceHistory, HIGH_PRACTICE_THRESHOLD_DAYS);
      if (recentCount >= HIGH_PRACTICE_COUNT) {
        results.push({
          id: generateId(),
          severity: 'info',
          rule: 'HIGH_RECENT_PRACTICE',
          message: `条目「${card.title}」近 ${HIGH_PRACTICE_THRESHOLD_DAYS} 天内试讲 ${recentCount} 次，强度较高，注意间隔复盘`,
          cardId: card.id,
          cardTitle: card.title
        });
      }
    }

    if (card.stageGoal && !card.stageGoal.completedAt) {
      const progress = calculateGoalProgress(card);
      if (progress) {
        if (progress.status === 'overdue') {
          results.push({
            id: generateId(),
            severity: 'error',
            rule: 'GOAL_OVERDUE',
            message: `条目「${card.title}」的阶段目标已逾期 ${Math.abs(progress.daysRemaining)} 天，请尽快完成`,
            cardId: card.id,
            cardTitle: card.title
          });
        } else if (progress.status === 'near_due') {
          results.push({
            id: generateId(),
            severity: 'warning',
            rule: 'GOAL_NEAR_DUE',
            message: `条目「${card.title}」的阶段目标将在 ${progress.daysRemaining} 天后截止，当前进度 ${Math.round(progress.overallProgress * 100)}%`,
            cardId: card.id,
            cardTitle: card.title
          });
        }

        if (progress.status === 'achieved' && !card.stageGoal.completedAt) {
          results.push({
            id: generateId(),
            severity: 'info',
            rule: 'GOAL_ACHIEVED_NOT_MARKED',
            message: `条目「${card.title}」已达成阶段目标，可手动确认完成`,
            cardId: card.id,
            cardTitle: card.title
          });
        }
      }
    }
  }

  const zoneMap = new Map<string, Map<string, PracticeCard[]>>();
  for (const card of cards) {
    if (!card.zone || !card.title) continue;
    if (!zoneMap.has(card.zone)) zoneMap.set(card.zone, new Map());
    const titleMap = zoneMap.get(card.zone)!;
    const key = card.title.trim().toLowerCase();
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key)!.push(card);
  }

  for (const [zone, titleMap] of zoneMap.entries()) {
    for (const [, group] of titleMap.entries()) {
      if (group.length > 1) {
        results.push({
          id: generateId(),
          severity: 'error',
          rule: 'DUPLICATE_ZONE_SEGMENT',
          message: `展区「${zone}」中存在 ${group.length} 个同名条目「${group[0].title}」，请确认是否重复`,
          cardId: group[0].id,
          cardTitle: group[0].title
        });
      }
    }
  }

  return results;
}

export function generateDailyPlan(cards: PracticeCard[]): DailyPracticePlan {
  const items: DailyPracticeItem[] = [];
  const now = Date.now();
  const DAY = 86400000;

  for (const card of cards) {
    let priority = 0;
    const reasons: string[] = [];

    if (card.stageGoal && !card.stageGoal.completedAt) {
      const goalProgress = calculateGoalProgress(card);
      if (goalProgress) {
        if (goalProgress.status === 'overdue') {
          priority += 60;
          reasons.push('目标已逾期');
        } else if (goalProgress.status === 'near_due') {
          priority += 45;
          reasons.push('目标临期');
        } else if (goalProgress.status === 'in_progress') {
          priority += 25;
          reasons.push('目标进行中');
        } else if (goalProgress.status === 'achieved') {
          priority += 5;
          reasons.push('目标待确认');
        }
      }
    }

    if (!card.isReviewed && (card.practiceCount > 0 || card.familiarity !== 'new')) {
      priority += 50;
      reasons.push('待复盘');
    }

    if (card.familiarity === 'new') {
      priority += 40;
      reasons.push('尚未开始');
    } else if (card.familiarity === 'learning') {
      priority += 30;
      reasons.push('学习中');
    } else if (card.familiarity === 'practicing') {
      priority += 20;
      reasons.push('练习中');
    }

    if (card.lastPracticedAt) {
      const days = Math.floor((now - card.lastPracticedAt) / DAY);
      if (days >= 7) {
        priority += 25;
        reasons.push(`已 ${days} 天未练`);
      } else if (days >= 3) {
        priority += 10;
        reasons.push(`${days} 天未复习`);
      }
    } else if (card.familiarity !== 'new') {
      priority += 15;
      reasons.push('从未试讲');
    }

    if (card.errorPoints.length > 0) {
      priority += Math.min(card.errorPoints.length * 3, 15);
      reasons.push(`含 ${card.errorPoints.length} 个易错点`);
    }

    if (card.isFavorite) {
      priority += 10;
      reasons.push('收藏重点');
    }

    if (priority > 0) {
      items.push({
        card,
        priority,
        reason: reasons.join('、')
      });
    }
  }

  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.card.lastPracticedAt || 0) - (b.card.lastPracticedAt || 0);
  });

  const totalDuration = items.reduce((sum, it) => sum + it.card.durationMinutes, 0);
  const needReviewCount = items.filter((it) => !it.card.isReviewed && it.card.practiceCount > 0).length;
  const needPracticeCount = items.filter((it) => it.card.familiarity !== 'mastered').length;

  return {
    items,
    totalDurationMinutes: totalDuration,
    needReviewCount,
    needPracticeCount
  };
}

export function exportToJson(
  cards: PracticeCard[],
  routes?: TrainingRoute[],
  runs?: RouteRunRecord[]
): string {
  const payload: Record<string, unknown> = {
    exportTime: new Date().toISOString(),
    version: 2,
    count: cards.length,
    cards
  };
  if (routes && routes.length > 0) {
    payload.routes = routes;
    payload.routeCount = routes.length;
  }
  if (runs && runs.length > 0) {
    payload.routeRuns = runs;
    payload.routeRunCount = runs.length;
  }
  return JSON.stringify(payload, null, 2);
}

export function exportToMarkdown(
  cards: PracticeCard[],
  routes?: TrainingRoute[],
  runs?: RouteRunRecord[]
): string {
  const lines: string[] = [];
  lines.push(`# 展馆讲解训练台导出`);
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`条目数量：${cards.length}`);
  lines.push(`总预计时长：${formatDuration(cards.reduce((s, c) => s + c.durationMinutes, 0))}`);
  if (routes && routes.length > 0) {
    lines.push(`训练路线：${routes.length} 条`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const card of cards) {
    lines.push(`## ${card.title}`);
    lines.push('');
    lines.push(`- **展区**：${card.zone || '未设置'}`);
    lines.push(`- **建议时长**：${card.durationMinutes} 分钟`);
    lines.push(`- **掌握度**：${card.familiarity}`);
    lines.push(`- **是否收藏**：${card.isFavorite ? '是' : '否'}`);
    lines.push(`- **是否复盘**：${card.isReviewed ? '是' : '否'}`);
    lines.push(`- **试讲次数**：${card.practiceCount}`);
    lines.push(`- **最后试讲**：${formatDate(card.lastPracticedAt)}`);
    lines.push('');

    if (card.stageGoal) {
      const goal = card.stageGoal;
      const progress = calculateGoalProgress(card);
      lines.push('### 阶段目标');
      lines.push('');
      lines.push(`- **目标掌握度**：${goal.targetFamiliarity === 'maintain' ? '保持现状' : goal.targetFamiliarity}`);
      lines.push(`- **目标试讲次数**：${goal.targetPracticeCount} 次`);
      lines.push(`- **目标复盘**：${goal.targetReviewDone ? '需要完成' : '不需要'}`);
      lines.push(`- **开始日期**：${formatDate(goal.startDate)}`);
      lines.push(`- **截止日期**：${formatDate(goal.dueDate)}`);
      if (goal.completedAt) {
        lines.push(`- **完成时间**：${formatDate(goal.completedAt)}`);
      }
      if (progress) {
        lines.push(`- **当前进度**：${Math.round(progress.overallProgress * 100)}%`);
        lines.push(`- **目标状态**：${{
          achieved: '已达成',
          in_progress: '进行中',
          near_due: '临期',
          overdue: '已逾期',
          none: '未设置'
        }[progress.status]}`);
      }
      lines.push('');
    }

    if (card.keywords.length) {
      lines.push('**关键词**：');
      card.keywords.forEach((k) => lines.push(`- ${k}`));
      lines.push('');
    }
    if (card.errorPoints.length) {
      lines.push('**易错点**：');
      card.errorPoints.forEach((e) => lines.push(`- ${e}`));
      lines.push('');
    }
    if (card.alternatives.length) {
      lines.push('**替代表达**：');
      card.alternatives.forEach((a) => lines.push(`- ${a}`));
      lines.push('');
    }
    if (card.reviewNote) {
      lines.push(`**复盘备注**：\n\n${card.reviewNote}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  if (routes && routes.length > 0) {
    lines.push('# 训练路线');
    lines.push('');

    for (const route of routes) {
      const steps = getRouteCards(route, cards);
      const summary = calculateRouteSummary(route, cards, runs || []);
      const routeRuns = (runs || []).filter((r) => r.routeId === route.id && r.finishedAt);

      lines.push(`## ${route.name || '(未命名路线)'}`);
      lines.push('');
      if (route.description) {
        lines.push(route.description);
        lines.push('');
      }
      lines.push(`- **目标日期**：${formatDate(route.targetDate)}`);
      lines.push(`- **创建时间**：${formatDate(route.createdAt)}`);
      lines.push(`- **最近修改**：${formatDate(route.updatedAt)}`);
      if (route.archivedAt) {
        lines.push(`- **归档时间**：${formatDate(route.archivedAt)}`);
      }
      if (route.lastRunAt) {
        lines.push(`- **最近执行**：${formatDateTime(route.lastRunAt)}`);
      }
      lines.push(`- **步骤数**：${summary.totalSteps}（有效 ${summary.validSteps}，缺失 ${summary.missingSteps}）`);
      lines.push(`- **预计总时长**：${formatDuration(summary.totalDurationMinutes)}`);
      lines.push(`- **执行次数**：${summary.totalRuns}`);
      if (summary.totalRuns > 0) {
        lines.push(`- **平均完成步骤**：${summary.avgPracticedCount}`);
      }
      lines.push('');

      lines.push('### 关联阶段目标摘要');
      lines.push('');
      lines.push(`- 已达成目标：${summary.goalAchievedCount} 个`);
      lines.push(`- 进行中目标：${summary.goalInProgressCount} 个`);
      lines.push(`- 临期目标：${summary.goalNearDueCount} 个`);
      lines.push(`- 逾期目标：${summary.goalOverdueCount} 个`);
      lines.push(`- 未复盘条目：${summary.unreviewedCount} 个`);
      lines.push(`- 缺失条目：${summary.missingSteps} 个`);
      lines.push('');

      lines.push('### 路线步骤');
      lines.push('');
      steps.forEach((step, idx) => {
        if (step.isMissing) {
          lines.push(`${idx + 1}. ⚠️ **[缺失条目]** ID: ${step.cardId}`);
        } else if (step.card) {
          const card = step.card;
          let goalInfo = '';
          if (card.stageGoal) {
            const status = getGoalStatus(card);
            const statusLabel: Record<GoalStatus, string> = {
              achieved: '已达成',
              in_progress: '进行中',
              near_due: '临期',
              overdue: '已逾期',
              none: '未设置'
            };
            const progress = calculateGoalProgress(card);
            goalInfo = ` | 目标: ${statusLabel[status]}${progress ? ` (${Math.round(progress.overallProgress * 100)}%)` : ''}`;
          }
          lines.push(`${idx + 1}. **${card.title}** (${card.zone || '未设展区'}, ${card.durationMinutes}分钟, ${FAMILIARITY_LABELS[card.familiarity]}${goalInfo})`);
        }
      });
      lines.push('');

      if (routeRuns.length > 0) {
        lines.push('### 执行记录');
        lines.push('');
        const sortedRuns = [...routeRuns].sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
        sortedRuns.forEach((run, idx) => {
          const duration = run.finishedAt
            ? Math.round((run.finishedAt - run.startedAt) / 60000)
            : 0;
          lines.push(`#### 第 ${idx + 1} 次执行`);
          lines.push('');
          lines.push(`- 开始时间：${formatDateTime(run.startedAt)}`);
          if (run.finishedAt) {
            lines.push(`- 完成时间：${formatDateTime(run.finishedAt)}`);
            lines.push(`- 耗时：约 ${duration} 分钟`);
          }
          lines.push(`- 已练习：${run.practicedCardIds.length} 个步骤`);
          lines.push(`- 已跳过：${run.skippedCardIds.length} 个步骤`);
          if (run.note) {
            lines.push(`- 备注：${run.note}`);
          }
          lines.push('');
        });
      }

      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function splitTags(input: string): string[] {
  return input
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function calculateGoalProgress(card: PracticeCard): GoalProgress | null {
  if (!card.stageGoal) return null;

  const goal = card.stageGoal;
  const now = Date.now();
  const DAY = 86400000;

  const daysRemaining = Math.ceil((goal.dueDate - now) / DAY);

  const practicesInPeriod = card.practiceHistory.filter((ts) => ts >= goal.startDate).length;
  const safeTargetPractice = Math.max(0, goal.targetPracticeCount);
  const practiceProgress = safeTargetPractice > 0
    ? Math.min(1, Math.max(0, practicesInPeriod / safeTargetPractice))
    : 1;

  let familiarityProgress = 1;
  if (goal.targetFamiliarity !== 'maintain') {
    const currentIdx = getFamiliarityIndex(card.familiarity);
    const targetIdx = getFamiliarityIndex(goal.targetFamiliarity);
    const startIdx = getFamiliarityIndex('new');
    if (targetIdx > startIdx) {
      const effectiveCurrent = Math.min(currentIdx, targetIdx);
      familiarityProgress = (effectiveCurrent - startIdx) / (targetIdx - startIdx);
    } else {
      familiarityProgress = currentIdx >= targetIdx ? 1 : 0;
    }
  }

  const reviewProgress = goal.targetReviewDone
    ? (card.isReviewed ? 1 : 0)
    : 1;

  let overallProgress = (practiceProgress + familiarityProgress + reviewProgress) / 3;

  let status: GoalStatus;
  if (goal.completedAt) {
    status = 'achieved';
    overallProgress = 1;
  } else if (overallProgress >= 1) {
    status = 'achieved';
    overallProgress = 1;
  } else if (daysRemaining < 0) {
    status = 'overdue';
  } else if (daysRemaining <= GOAL_NEAR_DUE_DAYS) {
    status = 'near_due';
  } else {
    status = 'in_progress';
  }

  return {
    practiceProgress,
    familiarityProgress,
    reviewProgress,
    overallProgress,
    daysRemaining,
    status
  };
}

export function getGoalStatus(card: PracticeCard): GoalStatus {
  const progress = calculateGoalProgress(card);
  return progress ? progress.status : 'none';
}

export function isGoalAchieved(card: PracticeCard): boolean {
  const progress = calculateGoalProgress(card);
  return progress !== null && progress.status === 'achieved';
}

export function getPracticesInGoalPeriod(card: PracticeCard): number {
  if (!card.stageGoal) return 0;
  const startDate = card.stageGoal.startDate;
  return card.practiceHistory.filter((ts) => ts >= startDate).length;
}

export function formatDaysRemaining(days: number): string {
  if (days > 0) return `剩余 ${days} 天`;
  if (days === 0) return '今天截止';
  return `逾期 ${Math.abs(days)} 天`;
}

export function getRouteCards(route: TrainingRoute, cards: PracticeCard[]): RouteStepCard[] {
  const cardMap = new Map<string, PracticeCard>();
  cards.forEach((c) => cardMap.set(c.id, c));
  return route.stepIds.map((cardId) => {
    const card = cardMap.get(cardId) || null;
    return { cardId, card, isMissing: card === null };
  });
}

export function calculateRouteSummary(
  route: TrainingRoute,
  cards: PracticeCard[],
  runs: RouteRunRecord[]
): RouteSummary {
  const steps = getRouteCards(route, cards);
  const validSteps = steps.filter((s) => !s.isMissing);
  const missingSteps = steps.filter((s) => s.isMissing);
  const totalDuration = validSteps.reduce((sum, s) => sum + (s.card ? s.card.durationMinutes : 0), 0);

  const routeRuns = runs.filter((r) => r.routeId === route.id);
  const completedRuns = routeRuns.filter((r) => r.finishedAt);
  const totalPracticed = completedRuns.reduce((sum, r) => sum + r.practicedCardIds.length, 0);
  const avgPracticedCount = completedRuns.length > 0
    ? Math.round((totalPracticed / completedRuns.length) * 10) / 10
    : 0;

  let goalAchievedCount = 0;
  let goalInProgressCount = 0;
  let goalNearDueCount = 0;
  let goalOverdueCount = 0;
  let unreviewedCount = 0;

  for (const step of validSteps) {
    if (step.card) {
      if (!step.card.isReviewed && step.card.practiceCount > 0) {
        unreviewedCount++;
      }
      if (step.card.stageGoal) {
        const status = getGoalStatus(step.card);
        if (status === 'achieved') goalAchievedCount++;
        else if (status === 'overdue') goalOverdueCount++;
        else if (status === 'near_due') goalNearDueCount++;
        else if (status === 'in_progress') goalInProgressCount++;
      }
    }
  }

  const lastRun = completedRuns.length > 0
    ? completedRuns.reduce((latest, r) =>
        r.finishedAt! > latest.finishedAt! ? r : latest
      )
    : null;

  return {
    totalSteps: steps.length,
    validSteps: validSteps.length,
    missingSteps: missingSteps.length,
    totalDurationMinutes: totalDuration,
    totalRuns: completedRuns.length,
    lastRunAt: lastRun?.finishedAt,
    avgPracticedCount,
    unreviewedCount,
    goalAchievedCount,
    goalInProgressCount,
    goalNearDueCount,
    goalOverdueCount
  };
}

export function sortRoutes(
  routes: TrainingRoute[],
  sortBy: RouteSortBy,
  sortOrder: 'asc' | 'desc'
): TrainingRoute[] {
  const result = [...routes];
  result.sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case 'targetDate':
        diff = a.targetDate - b.targetDate;
        break;
      case 'stepCount':
        diff = a.stepIds.length - b.stepIds.length;
        break;
      case 'updatedAt':
      default:
        diff = a.updatedAt - b.updatedAt;
        break;
    }
    return sortOrder === 'asc' ? diff : -diff;
  });
  return result;
}

function scoreCardForRecommendation(
  card: PracticeCard,
  now: number,
  recentRunCardIds: Set<string>
): { priority: number; reasons: string[] } {
  let priority = 0;
  const reasons: string[] = [];
  const DAY = 86400000;

  if (card.stageGoal && !card.stageGoal.completedAt) {
    const goalProgress = calculateGoalProgress(card);
    if (goalProgress) {
      if (goalProgress.status === 'overdue') {
        priority += 60;
        reasons.push('目标已逾期');
      } else if (goalProgress.status === 'near_due') {
        priority += 45;
        reasons.push('目标临期');
      } else if (goalProgress.status === 'in_progress') {
        priority += 25;
        reasons.push('目标进行中');
      } else if (goalProgress.status === 'achieved') {
        priority += 5;
        reasons.push('目标待确认');
      }
    }
  }

  if (!card.isReviewed && (card.practiceCount > 0 || card.familiarity !== 'new')) {
    priority += 50;
    reasons.push('待复盘');
  }

  if (card.familiarity === 'new') {
    priority += 40;
    reasons.push('尚未开始');
  } else if (card.familiarity === 'learning') {
    priority += 30;
    reasons.push('学习中');
  } else if (card.familiarity === 'practicing') {
    priority += 20;
    reasons.push('练习中');
  }

  if (card.lastPracticedAt) {
    const days = Math.floor((now - card.lastPracticedAt) / DAY);
    if (days >= 7) {
      priority += 25;
      reasons.push(`已 ${days} 天未练`);
    } else if (days >= 3) {
      priority += 10;
      reasons.push(`${days} 天未复习`);
    }
  } else if (card.familiarity !== 'new') {
    priority += 15;
    reasons.push('从未试讲');
  }

  if (card.errorPoints.length > 0) {
    priority += Math.min(card.errorPoints.length * 3, 15);
    reasons.push(`含 ${card.errorPoints.length} 个易错点`);
  }

  if (card.isFavorite) {
    priority += 10;
    reasons.push('收藏重点');
  }

  if (recentRunCardIds.has(card.id)) {
    priority -= 20;
  }

  return { priority, reasons };
}

function interleaveByZone<T extends { zone: string }>(items: T[]): T[] {
  const result = [...items];
  for (let i = 2; i < result.length; i++) {
    const zone = result[i].zone;
    if (!zone) continue;
    if (result[i - 1].zone === zone && result[i - 2].zone === zone) {
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].zone && result[j].zone !== zone) {
          [result[i], result[j]] = [result[j], result[i]];
          break;
        }
      }
    }
  }
  return result;
}

export const RECOMMENDED_ROUTE_MAX_ITEMS = 8;

export function generateRecommendedRoute(
  cards: PracticeCard[],
  _existingRoutes: TrainingRoute[],
  runs: RouteRunRecord[]
): TrainingRoute {
  const now = Date.now();
  const DAY = 86400000;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStartTs = today.getTime();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const recentRunCardIds = new Set<string>();
  runs.forEach((run) => {
    if (run.startedAt >= todayStartTs) {
      run.practicedCardIds.forEach((id) => recentRunCardIds.add(id));
    }
  });

  const scored = cards
    .filter((c) => c.title && c.title.trim().length > 0)
    .map((card) => ({
      card,
      ...scoreCardForRecommendation(card, now, recentRunCardIds)
    }))
    .filter((s) => s.priority > 0);

  scored.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.card.lastPracticedAt || 0) - (b.card.lastPracticedAt || 0);
  });

  const selected = scored.slice(0, RECOMMENDED_ROUTE_MAX_ITEMS);
  const interleaved = interleaveByZone(selected.map((s) => s.card));
  const stepIds = interleaved.map((c) => c.id);
  const totalDuration = interleaved.reduce((sum, c) => sum + c.durationMinutes, 0);

  const overdueCount = selected.filter((s) => s.reasons.includes('目标已逾期')).length;
  const nearDueCount = selected.filter((s) => s.reasons.includes('目标临期')).length;
  const reviewCount = selected.filter((s) => s.reasons.includes('待复盘')).length;
  const favCount = selected.filter((s) => s.card.isFavorite).length;
  const staleCount = selected.filter((s) => s.reasons.some((r) => r.includes('天未练'))).length;

  const reasonParts: string[] = [];
  if (overdueCount > 0) reasonParts.push(`${overdueCount} 个逾期目标`);
  if (nearDueCount > 0) reasonParts.push(`${nearDueCount} 个临期目标`);
  if (reviewCount > 0) reasonParts.push(`${reviewCount} 个待复盘`);
  if (favCount > 0) reasonParts.push(`${favCount} 个收藏重点`);
  if (staleCount > 0) reasonParts.push(`${staleCount} 个久未练习`);

  const description = stepIds.length > 0
    ? `自动推荐：${reasonParts.length > 0 ? reasonParts.join('、') + '；' : ''}共 ${stepIds.length} 个条目，预计 ${formatDuration(totalDuration)}。已按展区穿插排序，可调整顺序后保存。`
    : '自动推荐：当前没有需要重点练习的条目，可手动选择条目组建路线。';

  return {
    id: generateId(),
    name: `今日重点路线 ${todayStr}`,
    description,
    stepIds,
    targetDate: todayStartTs + DAY - 1,
    createdAt: now,
    updatedAt: now
  };
}
