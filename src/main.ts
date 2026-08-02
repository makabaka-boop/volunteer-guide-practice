import type {
  PracticeCard,
  FilterCriteria,
  FamiliarityLevel,
  CheckResult,
  DailyPracticePlan,
  GoalStatus,
  StageGoal,
  GoalFamiliarityTarget,
  TrainingRoute,
  RouteRunRecord,
  RouteSortBy
} from './types';
import {
  FAMILIARITY_LABELS,
  FAMILIARITY_COLORS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_COLORS,
  GOAL_FAMILIARITY_TARGET_LABELS
} from './types';
import {
  loadCards,
  saveCards,
  loadSelectedIds,
  saveSelectedIds,
  filterCards,
  createEmptyCard,
  cloneCard,
  getUniqueZones,
  generateId,
  createEmptyRoute,
  cloneRoute,
  loadRoutes,
  saveRoutes,
  loadRouteRuns,
  saveRouteRuns
} from './storage';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  runChecks,
  generateDailyPlan,
  exportToJson,
  exportToMarkdown,
  downloadFile,
  splitTags,
  calculateGoalProgress,
  getGoalStatus,
  isGoalAchieved,
  formatDaysRemaining,
  getRouteCards,
  calculateRouteSummary,
  generateRecommendedRoute
} from './utils';

let cards: PracticeCard[] = [];
let selectedIds: Set<string> = new Set();
let editingCard: PracticeCard | null = null;
let sortBy: string = 'updated';
let sortOrder: 'asc' | 'desc' = 'desc';

let routes: TrainingRoute[] = [];
let routeRuns: RouteRunRecord[] = [];
let routeSortBy: RouteSortBy = 'updatedAt';
let routeSortOrder: 'asc' | 'desc' = 'desc';
let editingRoute: TrainingRoute | null = null;
let activeRun: RouteRunRecord | null = null;
let runStepIndex = 0;
let routeStepSearch = '';
let routePickerScope: 'filtered' | 'all' = 'all';

const filterCriteria: FilterCriteria = {
  zones: [],
  familiarity: [],
  minDuration: null,
  maxDuration: null,
  hasErrorPoints: 'all',
  isReviewed: 'all',
  goalStatus: [],
  searchText: ''
};

type ToastType = 'success' | 'error' | 'warning' | 'info';
function toast(msg: string, type: ToastType = 'info'): void {
  const container = document.getElementById('toast-container')!;
  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? '' : type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

type ConfirmHandler = () => void;
function showConfirm(title: string, message: string, onOk: ConfirmHandler): void {
  const backdrop = document.getElementById('modal-backdrop')!;
  const modal = document.getElementById('confirm-modal')!;
  document.getElementById('confirm-title')!.textContent = title;
  document.getElementById('confirm-message')!.textContent = message;

  backdrop.style.display = 'flex';
  modal.style.display = 'flex';

  const hide = () => {
    backdrop.style.display = 'none';
    modal.style.display = 'none';
  };

  const okBtn = document.getElementById('confirm-ok')!;
  const cancelBtn = document.getElementById('confirm-cancel')!;
  const okHandler = () => {
    okBtn.removeEventListener('click', okHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    hide();
    onOk();
  };
  const cancelHandler = () => {
    okBtn.removeEventListener('click', okHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    hide();
  };
  okBtn.addEventListener('click', okHandler);
  cancelBtn.addEventListener('click', cancelHandler);
}

function openModal(modalId: string): void {
  const backdrop = document.getElementById('modal-backdrop')!;
  const modal = document.getElementById(modalId)!;
  backdrop.style.display = 'flex';
  modal.style.display = 'flex';
  modal.querySelectorAll('[data-close]').forEach((btn) => {
    (btn as HTMLElement).onclick = () => closeModal(modalId);
  });
}

function closeModal(modalId: string): void {
  const backdrop = document.getElementById('modal-backdrop')!;
  const modal = document.getElementById(modalId)!;
  const anyOpen = Array.from(backdrop.querySelectorAll('.modal')).some(
    (m) => (m as HTMLElement).style.display === 'flex' && m.id !== modalId
  );
  modal.style.display = 'none';
  if (!anyOpen) backdrop.style.display = 'none';
}

function persist(): void {
  saveCards(cards);
  saveSelectedIds(selectedIds);
  saveRoutes(routes);
  saveRouteRuns(routeRuns);
}

function render(): void {
  renderZoneChips();
  renderStats();
  renderCards();
  renderBatchPanel();
  renderRoutes();
}

function renderZoneChips(): void {
  const zones = getUniqueZones(cards);
  const container = document.getElementById('filter-zones')!;
  container.innerHTML = '';
  if (zones.length === 0) {
    container.innerHTML = '<span class="empty-hint">暂无展区</span>';
    return;
  }
  zones.forEach((zone) => {
    const label = document.createElement('label');
    label.className = 'chip';
    const checked = filterCriteria.zones.includes(zone);
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(zone)}" ${checked ? 'checked' : ''} /><span>${escapeHtml(zone)}</span>`;
    container.appendChild(label);
  });
  container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value;
      if ((e.target as HTMLInputElement).checked) {
        if (!filterCriteria.zones.includes(val)) filterCriteria.zones.push(val);
      } else {
        filterCriteria.zones = filterCriteria.zones.filter((z) => z !== val);
      }
      renderCards();
      renderBatchPanel();
    });
  });
}

function renderStats(): void {
  const total = cards.length;
  const favCount = cards.filter((c) => c.isFavorite).length;
  const reviewedCount = cards.filter((c) => c.isReviewed).length;
  const masteredCount = cards.filter((c) => c.familiarity === 'mastered').length;
  const totalDuration = cards.reduce((s, c) => s + c.durationMinutes, 0);

  const hasGoalCount = cards.filter((c) => c.stageGoal && !c.stageGoal.completedAt).length;
  const achievedCount = cards.filter((c) => isGoalAchieved(c)).length;
  const nearDueCount = cards.filter((c) => getGoalStatus(c) === 'near_due').length;
  const overdueCount = cards.filter((c) => getGoalStatus(c) === 'overdue').length;

  document.getElementById('stats')!.innerHTML = `
    <div class="stat-item"><div class="stat-value">${total}</div><div class="stat-label">条目数</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#f59e0b">${favCount}</div><div class="stat-label">⭐ 收藏</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#10b981">${reviewedCount}</div><div class="stat-label">已复盘</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#3b82f6">${masteredCount}</div><div class="stat-label">已掌握</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#8b5cf6">${hasGoalCount}</div><div class="stat-label">🎯 进行中目标</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#10b981">${achievedCount}</div><div class="stat-label">✅ 已达成</div></div>
    ${nearDueCount > 0 ? `<div class="stat-item"><div class="stat-value" style="color:#f59e0b">${nearDueCount}</div><div class="stat-label">⏰ 临期</div></div>` : ''}
    ${overdueCount > 0 ? `<div class="stat-item"><div class="stat-value" style="color:#ef4444">${overdueCount}</div><div class="stat-label">⚠️ 逾期</div></div>` : ''}
    <div class="stat-item full" style="background:linear-gradient(135deg,#eef2ff,#ecfdf5)">
      <div class="stat-value" style="font-size:16px">${formatDuration(totalDuration)}</div>
      <div class="stat-label">总时长</div>
    </div>
  `;
}

function getFilteredSortedCards(): PracticeCard[] {
  let result = filterCards(cards, filterCriteria);
  result.sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case 'created': diff = a.createdAt - b.createdAt; break;
      case 'duration': diff = a.durationMinutes - b.durationMinutes; break;
      case 'title': diff = a.title.localeCompare(b.title, 'zh-CN'); break;
      case 'zone': diff = a.zone.localeCompare(b.zone, 'zh-CN'); break;
      case 'practice': diff = a.practiceCount - b.practiceCount; break;
      case 'updated':
      default: diff = a.updatedAt - b.updatedAt; break;
    }
    return sortOrder === 'asc' ? diff : -diff;
  });
  return result;
}

function renderCards(): void {
  const list = getFilteredSortedCards();
  const container = document.getElementById('cards-container')!;
  const empty = document.getElementById('empty-state')!;
  const info = document.getElementById('results-info')!;

  const selectedInView = list.filter((c) => selectedIds.has(c.id)).length;
  info.innerHTML = `共 <strong>${list.length}</strong> 个条目${selectedInView > 0 ? `，已选 <strong>${selectedInView}</strong> 个` : ''}${list.length > 0 ? `，预计总时长 <strong>${formatDuration(list.reduce((s, c) => s + c.durationMinutes, 0))}</strong>` : ''}`;

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  container.innerHTML = list.map(renderCardHtml).join('');

  container.querySelectorAll('.card').forEach((cardEl) => {
    const id = cardEl.getAttribute('data-id')!;
    const card = cards.find((c) => c.id === id)!;
    if (!card) return;

    const check = cardEl.querySelector('.card-check input') as HTMLInputElement;
    check.addEventListener('change', () => {
      if (check.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      persist();
      cardEl.classList.toggle('selected', check.checked);
      renderBatchPanel();
      renderCards();
    });

    const favBtn = cardEl.querySelector('.fav-btn') as HTMLButtonElement;
    favBtn.addEventListener('click', () => {
      card.isFavorite = !card.isFavorite;
      card.updatedAt = Date.now();
      persist();
      render();
    });

    const editBtn = cardEl.querySelector('[data-action="edit"]') as HTMLButtonElement;
    editBtn.addEventListener('click', () => openCardEditor(card));

    const copyBtn = cardEl.querySelector('[data-action="copy"]') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => {
      const newCard = cloneCard(card);
      cards.push(newCard);
      persist();
      render();
      toast(`已复制「${card.title}」`, 'success');
    });

    const practiceBtn = cardEl.querySelector('[data-action="practice"]') as HTMLButtonElement;
    practiceBtn.addEventListener('click', () => {
      const now = Date.now();
      card.practiceCount++;
      card.lastPracticedAt = now;
      card.practiceHistory = [...(card.practiceHistory || []), now];
      card.updatedAt = now;
      persist();
      render();
      toast(`已记录一次试讲「${card.title}」，累计 ${card.practiceCount} 次`, 'success');
    });

    const goalCompleteBtn = cardEl.querySelector('[data-action="goal-complete"]') as HTMLButtonElement | null;
    if (goalCompleteBtn) {
      goalCompleteBtn.addEventListener('click', () => {
        if (card.stageGoal) {
          showConfirm('确认完成目标', `确认将「${card.title}」的阶段目标标记为已完成？`, () => {
            card.stageGoal!.completedAt = Date.now();
            card.updatedAt = Date.now();
            persist();
            render();
            toast('目标已标记为完成', 'success');
          });
        }
      });
    }

    const goalUncompleteBtn = cardEl.querySelector('[data-action="goal-uncomplete"]') as HTMLButtonElement | null;
    if (goalUncompleteBtn) {
      goalUncompleteBtn.addEventListener('click', () => {
        if (card.stageGoal) {
          showConfirm('撤销完成标记', `确认撤销「${card.title}」的目标完成标记？`, () => {
            card.stageGoal!.completedAt = undefined;
            card.updatedAt = Date.now();
            persist();
            render();
            toast('已撤销完成标记', 'info');
          });
        }
      });
    }

    const delBtn = cardEl.querySelector('[data-action="delete"]') as HTMLButtonElement;
    delBtn.addEventListener('click', () => {
      showConfirm('删除条目', `确认删除「${card.title}」？此操作不可恢复。`, () => {
        cards = cards.filter((c) => c.id !== id);
        selectedIds.delete(id);
        persist();
        render();
        const affectedRoutes = routes.filter((r) => r.stepIds.includes(id)).length;
        if (affectedRoutes > 0) {
          toast(`已删除；${affectedRoutes} 条训练路线包含失效步骤，可在路线页一键清理`, 'warning');
        } else {
          toast('已删除', 'success');
        }
      });
    });
  });
}

function renderCardHtml(card: PracticeCard): string {
  const famClass = `fam-${card.familiarity}`;
  const isSelected = selectedIds.has(card.id);
  const famColor = FAMILIARITY_COLORS[card.familiarity];
  const goalProgress = calculateGoalProgress(card);
  const goalStatus = goalProgress ? goalProgress.status : 'none';
  const goalColor = GOAL_STATUS_COLORS[goalStatus];

  let goalSection = '';
  if (card.stageGoal && goalProgress) {
    const progressPercent = Math.round(goalProgress.overallProgress * 100);
    const daysText = formatDaysRemaining(goalProgress.daysRemaining);
    const statusLabel = GOAL_STATUS_LABELS[goalStatus];
    const isCompleted = !!card.stageGoal.completedAt;
    const canMarkComplete = goalStatus === 'achieved' && !isCompleted;

    goalSection = `
      <div class="section goal-section">
        <div class="section-title">
          🎯 阶段目标
          <span class="goal-status-badge" style="background:${goalColor}">${statusLabel}</span>
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill" style="width:${progressPercent}%;background:${goalColor}"></div>
        </div>
        <div class="goal-meta">
          <span class="goal-percent">${progressPercent}%</span>
          <span class="goal-days" style="color:${goalColor}">${daysText}</span>
        </div>
        <div class="goal-details">
          <span title="目标掌握度">📈 ${GOAL_FAMILIARITY_TARGET_LABELS[card.stageGoal.targetFamiliarity]}</span>
          <span title="目标试讲次数">🎯 ${card.stageGoal.targetPracticeCount} 次</span>
          ${card.stageGoal.targetReviewDone ? '<span title="需复盘">📝 复盘</span>' : ''}
          ${isCompleted ? `<span title="完成时间">✅ ${formatDate(card.stageGoal.completedAt)} 完成</span>` : ''}
        </div>
        <div class="goal-actions">
          ${canMarkComplete ? `<button class="goal-action-btn" data-action="goal-complete" title="确认目标已完成">✓ 确认完成</button>` : ''}
          ${isCompleted ? `<button class="goal-action-btn outline" data-action="goal-uncomplete" title="撤销完成标记">撤销完成</button>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="card ${isSelected ? 'selected' : ''}" data-id="${card.id}">
      <div class="card-header">
        <div class="card-check">
          <input type="checkbox" ${isSelected ? 'checked' : ''} aria-label="选择条目" />
        </div>
        <div class="card-header-main">
          <div class="card-title-row">
            <h3 class="card-title" title="${escapeHtml(card.title)}">${escapeHtml(card.title || '(未命名)')}</h3>
            <button class="fav-btn ${card.isFavorite ? 'on' : ''}" title="收藏">${card.isFavorite ? '⭐' : '☆'}</button>
          </div>
          <div class="card-meta">
            ${card.zone ? `<span class="zone-tag">📍 ${escapeHtml(card.zone)}</span>` : ''}
            <span class="duration-tag">⏱️ ${card.durationMinutes} 分钟</span>
            <span class="fam-tag ${famClass}" style="background:${famColor}">${FAMILIARITY_LABELS[card.familiarity]}</span>
          </div>
        </div>
      </div>
      <div class="card-body">
        ${goalSection}
        ${card.keywords.length > 0 ? `
          <div class="section">
            <div class="section-title">🔑 关键词 (${card.keywords.length})</div>
            <div class="tag-cloud">${card.keywords.map((k) => `<span class="tag-item">${escapeHtml(k)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${card.errorPoints.length > 0 ? `
          <div class="section">
            <div class="section-title">⚠️ 易错点 (${card.errorPoints.length})</div>
            <div class="tag-cloud">${card.errorPoints.map((e) => `<span class="tag-item error">${escapeHtml(e)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${card.alternatives.length > 0 ? `
          <div class="section">
            <div class="section-title">💬 替代表达 (${card.alternatives.length})</div>
            <div class="tag-cloud">${card.alternatives.map((a) => `<span class="tag-item alt">${escapeHtml(a)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${card.reviewNote ? `
          <div class="section">
            <div class="section-title">📝 复盘备注</div>
            <div class="review-note">${escapeHtml(card.reviewNote)}</div>
          </div>
        ` : ''}
      </div>
      <div class="status-row">
        <div class="status-badges">
          <span class="badge ${card.isReviewed ? 'reviewed' : 'not-reviewed'}">
            ${card.isReviewed ? '✅ 已复盘' : '⏳ 待复盘'}
          </span>
          ${card.stageGoal ? `
            <span class="badge goal-badge" style="background:${goalColor}20;color:${goalColor}">
              ${goalStatus === 'achieved' ? '🎯' : goalStatus === 'overdue' ? '⏰' : goalStatus === 'near_due' ? '⚡' : '📈'} 
              ${GOAL_STATUS_LABELS[goalStatus]}
            </span>
          ` : ''}
        </div>
        <div class="practice-info">试讲 ${card.practiceCount} 次 · ${formatDate(card.lastPracticedAt)}</div>
      </div>
      <div class="card-actions">
        <button data-action="practice" title="记录一次试讲">🎯 试讲</button>
        <button data-action="edit" title="编辑">✏️ 编辑</button>
        <button data-action="copy" title="复制条目">📋 复制</button>
        <button data-action="delete" class="danger" title="删除">🗑️ 删除</button>
      </div>
    </div>
  `;
}

function renderBatchPanel(): void {
  const panel = document.getElementById('batch-panel')!;
  const countEl = document.getElementById('selected-count')!;
  const count = selectedIds.size;
  if (count === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  countEl.textContent = `（已选 ${count}）`;
}

function openCardEditor(card: PracticeCard | null): void {
  editingCard = card ? { ...card } : createEmptyCard();
  document.getElementById('modal-title')!.textContent = card ? '编辑条目' : '新建条目';

  (document.getElementById('f-title') as HTMLInputElement).value = editingCard.title;
  (document.getElementById('f-zone') as HTMLInputElement).value = editingCard.zone;
  (document.getElementById('f-duration') as HTMLInputElement).value = String(editingCard.durationMinutes);
  (document.getElementById('f-familiarity') as HTMLSelectElement).value = editingCard.familiarity;
  (document.getElementById('f-keywords') as HTMLTextAreaElement).value = editingCard.keywords.join('、');
  (document.getElementById('f-errorpoints') as HTMLTextAreaElement).value = editingCard.errorPoints.join('\n');
  (document.getElementById('f-alternatives') as HTMLTextAreaElement).value = editingCard.alternatives.join('\n');
  (document.getElementById('f-review') as HTMLTextAreaElement).value = editingCard.reviewNote;
  (document.getElementById('f-favorite') as HTMLInputElement).checked = editingCard.isFavorite;
  (document.getElementById('f-reviewed') as HTMLInputElement).checked = editingCard.isReviewed;

  const hasGoal = !!editingCard.stageGoal;
  const hasGoalEl = document.getElementById('f-has-goal') as HTMLInputElement;
  const goalFamEl = document.getElementById('f-goal-familiarity') as HTMLSelectElement;
  const goalPracticeEl = document.getElementById('f-goal-practice') as HTMLInputElement;
  const goalReviewEl = document.getElementById('f-goal-review') as HTMLSelectElement;
  const goalDueEl = document.getElementById('f-goal-due') as HTMLInputElement;

  hasGoalEl.checked = hasGoal;
  goalFamEl.disabled = !hasGoal;
  goalPracticeEl.disabled = !hasGoal;
  goalReviewEl.disabled = !hasGoal;
  goalDueEl.disabled = !hasGoal;

  if (hasGoal && editingCard.stageGoal) {
    goalFamEl.value = editingCard.stageGoal.targetFamiliarity;
    goalPracticeEl.value = String(editingCard.stageGoal.targetPracticeCount);
    goalReviewEl.value = editingCard.stageGoal.targetReviewDone ? 'yes' : 'no';
    const dueDate = new Date(editingCard.stageGoal.dueDate);
    goalDueEl.value = dueDate.toISOString().split('T')[0];
  } else {
    goalFamEl.value = editingCard.familiarity !== 'new' ? 'maintain' : 'learning';
    goalPracticeEl.value = '5';
    goalReviewEl.value = 'no';
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 7);
    goalDueEl.value = defaultDue.toISOString().split('T')[0];
  }

  hasGoalEl.removeEventListener('change', handleGoalToggle);
  hasGoalEl.addEventListener('change', handleGoalToggle);

  const zoneDl = document.getElementById('zone-list')!;
  const zones = getUniqueZones(cards);
  zoneDl.innerHTML = zones.map((z) => `<option value="${escapeHtml(z)}">`).join('');

  openModal('card-modal');
}

function handleGoalToggle(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked;
  (document.getElementById('f-goal-familiarity') as HTMLSelectElement).disabled = !checked;
  (document.getElementById('f-goal-practice') as HTMLInputElement).disabled = !checked;
  (document.getElementById('f-goal-review') as HTMLSelectElement).disabled = !checked;
  (document.getElementById('f-goal-due') as HTMLInputElement).disabled = !checked;
}

function saveCardFromForm(): boolean {
  if (!editingCard) return false;

  const title = (document.getElementById('f-title') as HTMLInputElement).value.trim();
  const zone = (document.getElementById('f-zone') as HTMLInputElement).value.trim();
  const duration = parseInt((document.getElementById('f-duration') as HTMLInputElement).value, 10);

  if (!title) { toast('请填写片段标题', 'error'); return false; }
  if (!zone) { toast('请填写关联展区', 'error'); return false; }
  if (isNaN(duration) || duration <= 0) { toast('请输入有效的建议时长', 'error'); return false; }

  const keywordsRaw = (document.getElementById('f-keywords') as HTMLTextAreaElement).value;
  const errorsRaw = (document.getElementById('f-errorpoints') as HTMLTextAreaElement).value;
  const altsRaw = (document.getElementById('f-alternatives') as HTMLTextAreaElement).value;
  const reviewRaw = (document.getElementById('f-review') as HTMLTextAreaElement).value.trim();
  const fam = (document.getElementById('f-familiarity') as HTMLSelectElement).value as FamiliarityLevel;
  const fav = (document.getElementById('f-favorite') as HTMLInputElement).checked;
  const reviewed = (document.getElementById('f-reviewed') as HTMLInputElement).checked;

  const hasGoal = (document.getElementById('f-has-goal') as HTMLInputElement).checked;
  const goalFam = (document.getElementById('f-goal-familiarity') as HTMLSelectElement).value as GoalFamiliarityTarget;
  const goalPractice = parseInt((document.getElementById('f-goal-practice') as HTMLInputElement).value, 10);
  const goalReviewVal = (document.getElementById('f-goal-review') as HTMLSelectElement).value;
  const goalDueStr = (document.getElementById('f-goal-due') as HTMLInputElement).value;

  if (hasGoal) {
    if (!goalDueStr) {
      toast('请填写目标截止日期', 'error');
      return false;
    }
    if (isNaN(goalPractice) || goalPractice < 0) {
      toast('目标试讲次数不能为负数', 'error');
      return false;
    }
  }

  const now = Date.now();
  const isNew = !cards.some((c) => c.id === editingCard!.id);

  editingCard.title = title;
  editingCard.zone = zone;
  editingCard.durationMinutes = duration;
  editingCard.familiarity = fam;
  editingCard.keywords = splitTags(keywordsRaw);
  editingCard.errorPoints = errorsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  editingCard.alternatives = altsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  editingCard.reviewNote = reviewRaw;
  editingCard.isFavorite = fav;
  editingCard.isReviewed = reviewed;
  editingCard.updatedAt = now;

  if (hasGoal && goalDueStr) {
    const dueDate = new Date(goalDueStr).getTime();
    const existingGoal = editingCard.stageGoal;
    const startDate = existingGoal ? existingGoal.startDate : now;

    const wasCompleted = existingGoal?.completedAt;
    const newGoal: StageGoal = {
      targetFamiliarity: goalFam,
      targetPracticeCount: Math.max(0, isNaN(goalPractice) ? 0 : goalPractice),
      targetReviewDone: goalReviewVal === 'yes',
      startDate,
      dueDate,
      completedAt: wasCompleted
    };

    editingCard.stageGoal = newGoal;
  } else if (!hasGoal) {
    editingCard.stageGoal = undefined;
  }

  if (isNew) {
    cards.push(editingCard);
  } else {
    const idx = cards.findIndex((c) => c.id === editingCard!.id);
    if (idx >= 0) cards[idx] = editingCard;
  }

  persist();
  closeModal('card-modal');
  editingCard = null;
  render();
  toast(isNew ? '已创建条目' : '已保存修改', 'success');
  return true;
}

function applyBatchChanges(): void {
  if (selectedIds.size === 0) return;

  const famVal = (document.getElementById('batch-familiarity') as HTMLSelectElement).value;
  const reviewVal = (document.getElementById('batch-reviewed') as HTMLSelectElement).value;
  const favVal = (document.getElementById('batch-favorite') as HTMLSelectElement).value;

  if (!famVal && !reviewVal && !favVal) {
    toast('请至少选择一项调整内容', 'warning');
    return;
  }

  let changed = 0;
  cards.forEach((card) => {
    if (!selectedIds.has(card.id)) return;
    if (famVal) { card.familiarity = famVal as FamiliarityLevel; changed++; }
    if (reviewVal === 'yes') { card.isReviewed = true; changed++; }
    if (reviewVal === 'no') { card.isReviewed = false; changed++; }
    if (favVal === 'yes') { card.isFavorite = true; changed++; }
    if (favVal === 'no') { card.isFavorite = false; changed++; }
    card.updatedAt = Date.now();
  });

  persist();
  (document.getElementById('batch-familiarity') as HTMLSelectElement).value = '';
  (document.getElementById('batch-reviewed') as HTMLSelectElement).value = '';
  (document.getElementById('batch-favorite') as HTMLSelectElement).value = '';
  render();
  toast(`已批量更新 ${changed} 项属性`, 'success');
}

function showDailyPlan(): void {
  const plan: DailyPracticePlan = generateDailyPlan(cards);
  const summary = document.getElementById('daily-summary')!;
  const list = document.getElementById('daily-list')!;

  summary.innerHTML = `
    <div class="daily-stat"><div class="num">${plan.items.length}</div><div class="lbl">建议条目</div></div>
    <div class="daily-stat"><div class="num">${formatDuration(plan.totalDurationMinutes)}</div><div class="lbl">预计总时长</div></div>
    <div class="daily-stat"><div class="num" style="color:#f59e0b">${plan.needReviewCount}</div><div class="lbl">待复盘</div></div>
  `;

  if (plan.items.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">🎉</div><div class="empty-title">太棒了！</div><div class="empty-desc">当前没有需要重点处理的条目，继续保持～</div></div>`;
  } else {
    list.innerHTML = plan.items.map((it, idx) => {
      const famColor = FAMILIARITY_COLORS[it.card.familiarity];
      return `
        <div class="daily-item" data-id="${it.card.id}">
          <div class="daily-priority">${idx + 1}</div>
          <div class="daily-item-info">
            <div class="daily-item-title">${escapeHtml(it.card.title)}
              <span class="fam-tag fam-${it.card.familiarity}" style="background:${famColor};margin-left:6px">${FAMILIARITY_LABELS[it.card.familiarity]}</span>
            </div>
            <div class="daily-item-meta">
              <span>📍 ${escapeHtml(it.card.zone || '未设展区')}</span>
              <span>⏱️ ${it.card.durationMinutes} 分钟</span>
              <span>🎯 已试讲 ${it.card.practiceCount} 次</span>
              ${it.card.isFavorite ? '<span style="color:#f59e0b">⭐</span>' : ''}
            </div>
          </div>
          <span class="daily-reason">${escapeHtml(it.reason)}</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.daily-item').forEach((el) => {
      const item = el as HTMLElement;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id')!;
        const card = cards.find((c) => c.id === id);
        if (card) {
          closeModal('daily-modal');
          openCardEditor(card);
        }
      });
    });
  }

  openModal('daily-modal');
}

function showCheckResults(): void {
  const results: CheckResult[] = runChecks(cards);
  const container = document.getElementById('check-results')!;

  if (results.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">✅</div><div class="empty-title">检查通过</div><div class="empty-desc">未发现任何问题，做得很好！</div></div>`;
  } else {
    const bySev: Record<string, CheckResult[]> = { error: [], warning: [], info: [] };
    results.forEach((r) => bySev[r.severity].push(r));

    container.innerHTML = `
      <div class="daily-summary" style="margin-bottom:16px">
        <div class="daily-stat"><div class="num" style="color:#ef4444">${bySev.error.length}</div><div class="lbl">错误</div></div>
        <div class="daily-stat"><div class="num" style="color:#f59e0b">${bySev.warning.length}</div><div class="lbl">警告</div></div>
        <div class="daily-stat"><div class="num" style="color:#3b82f6">${bySev.info.length}</div><div class="lbl">提示</div></div>
      </div>
      ${results.map((r) => `
        <div class="check-item ${r.severity}" data-card-id="${r.cardId || ''}">
          <div><span class="sev">${{ error: '错误', warning: '警告', info: '提示' }[r.severity]}</span>${escapeHtml(r.message)}</div>
          ${r.cardTitle ? `<div class="card-ref">关联条目：${escapeHtml(r.cardTitle)}（点击查看）</div>` : ''}
        </div>
      `).join('')}
    `;

    container.querySelectorAll('.check-item').forEach((el) => {
      const item = el as HTMLElement;
      const cardId = item.getAttribute('data-card-id');
      if (cardId) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          const card = cards.find((c) => c.id === cardId);
          if (card) {
            closeModal('check-modal');
            openCardEditor(card);
          }
        });
      }
    });
  }

  openModal('check-modal');
}

function switchView(view: 'cards' | 'routes'): void {
  document.getElementById('cards-view')!.style.display = view === 'cards' ? 'flex' : 'none';
  document.getElementById('routes-view')!.style.display = view === 'routes' ? 'flex' : 'none';
  document.getElementById('tab-cards')!.classList.toggle('active', view === 'cards');
  document.getElementById('tab-routes')!.classList.toggle('active', view === 'routes');
  if (view === 'routes') renderRoutes();
}

function getSortedRoutes(): TrainingRoute[] {
  const list = [...routes];
  list.sort((a, b) => {
    let diff = 0;
    switch (routeSortBy) {
      case 'targetDate':
        if (a.targetDate === 0 && b.targetDate === 0) diff = 0;
        else if (a.targetDate === 0) return 1;
        else if (b.targetDate === 0) return -1;
        else diff = a.targetDate - b.targetDate;
        break;
      case 'stepCount':
        diff = a.stepIds.length - b.stepIds.length;
        break;
      case 'updatedAt':
      default:
        diff = a.updatedAt - b.updatedAt;
        break;
    }
    return routeSortOrder === 'asc' ? diff : -diff;
  });
  return list;
}

function renderRoutes(): void {
  const container = document.getElementById('routes-container')!;
  const empty = document.getElementById('routes-empty')!;
  const info = document.getElementById('routes-info')!;
  const list = getSortedRoutes();

  const activeCount = routes.filter((r) => !r.archivedAt).length;
  info.innerHTML = `共 <strong>${routes.length}</strong> 条路线（进行中 ${activeCount} 条，已归档 ${routes.length - activeCount} 条）`;

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  container.innerHTML = list.map(renderRouteHtml).join('');

  container.querySelectorAll('.route-card').forEach((el) => {
    const id = el.getAttribute('data-id')!;
    const route = routes.find((r) => r.id === id);
    if (!route) return;

    const bind = (action: string, handler: () => void): void => {
      const btn = el.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null;
      if (btn) btn.addEventListener('click', handler);
    };

    bind('run', () => startRouteRun(route));
    bind('runs', () => showRouteRuns(route));
    bind('edit', () => openRouteEditor(route));
    bind('copy', () => {
      const copy = cloneRoute(route);
      routes.push(copy);
      persist();
      renderRoutes();
      toast(`已复制路线「${route.name}」`, 'success');
    });
    bind('archive', () => {
      route.archivedAt = route.archivedAt ? undefined : Date.now();
      route.updatedAt = Date.now();
      persist();
      renderRoutes();
      toast(route.archivedAt ? '路线已归档' : '路线已恢复', 'success');
    });
    bind('delete', () => {
      showConfirm('删除路线', `确认删除路线「${route.name || '未命名路线'}」？该路线的演练记录将一并删除。`, () => {
        routes = routes.filter((r) => r.id !== id);
        routeRuns = routeRuns.filter((r) => r.routeId !== id);
        persist();
        renderRoutes();
        toast('路线已删除', 'success');
      });
    });
    bind('cleanup', () => cleanupRouteSteps(route));
  });
}

function renderRouteHtml(route: TrainingRoute): string {
  const summary = calculateRouteSummary(route, cards, routeRuns);
  const steps = getRouteCards(route, cards);
  const isArchived = !!route.archivedAt;
  const goal = summary.goalSummary;
  const goalPercent = Math.round(goal.overallProgress * 100);
  const targetText = route.targetDate ? formatDate(route.targetDate) : '未设置';
  const targetOverdue = route.targetDate > 0 && route.targetDate < Date.now();

  const preview = steps.slice(0, 6).map((s, i) => (
    s.card
      ? `<span class="route-step-chip">${i + 1}. ${escapeHtml(s.card.title)}</span>`
      : `<span class="route-step-chip missing">${i + 1}. ⚠️ 缺失条目</span>`
  )).join('');
  const moreChip = steps.length > 6 ? `<span class="route-step-chip more">… 共 ${steps.length} 步</span>` : '';
  const emptyHint = steps.length === 0 ? '<span class="empty-hint">尚未添加步骤，点击「编辑」组织讲解条目</span>' : '';

  return `
    <div class="route-card ${isArchived ? 'archived' : ''}" data-id="${route.id}">
      <div class="route-card-main">
        <div class="route-card-header">
          <h3 class="card-title" title="${escapeHtml(route.name)}">${escapeHtml(route.name || '(未命名路线)')}</h3>
          ${isArchived ? '<span class="badge" style="background:#e2e8f0;color:#64748b">📦 已归档</span>' : ''}
        </div>
        ${route.description ? `<div class="route-desc">${escapeHtml(route.description)}</div>` : ''}
        <div class="card-meta">
          <span class="zone-tag">🧩 ${summary.stepCount} 步</span>
          <span class="duration-tag">⏱️ ${formatDuration(summary.totalDurationMinutes)}</span>
          <span class="duration-tag" style="${targetOverdue ? 'color:#ef4444;font-weight:600' : ''}">📅 目标 ${targetText}</span>
          <span class="duration-tag" style="${summary.unreviewedCount > 0 ? 'color:#f59e0b;font-weight:600' : ''}">📝 未复盘 ${summary.unreviewedCount}</span>
          <span class="duration-tag" style="${goal.nearDue > 0 ? 'color:#f59e0b;font-weight:600' : ''}">⚡ 临期 ${goal.nearDue}</span>
          <span class="duration-tag" style="${goal.overdue > 0 ? 'color:#ef4444;font-weight:600' : ''}">⏰ 逾期 ${goal.overdue}</span>
          <span class="duration-tag" style="${summary.missingCount > 0 ? 'color:#ef4444;font-weight:600' : ''}">⚠️ 缺失 ${summary.missingCount}</span>
          <span class="duration-tag">🕘 最近演练 ${formatDate(summary.lastRunAt)}</span>
          <span class="duration-tag">🔁 演练 ${summary.runCount} 次（完成 ${summary.finishedRunCount}）</span>
        </div>
        <div class="route-steps-preview">${preview}${moreChip}${emptyHint}</div>
        ${summary.missingCount > 0 ? `
          <div class="route-missing-bar">
            <span>⚠️ ${summary.missingCount} 个步骤引用的条目已被删除</span>
            <button class="btn-link small" data-action="cleanup">🧹 一键清理失效步骤</button>
          </div>
        ` : ''}
        ${goal.totalWithGoals > 0 ? `
          <div class="route-goal-summary">
            <div class="section-title">🎯 阶段目标摘要 <span class="goal-percent">${goalPercent}%</span></div>
            <div class="goal-progress-bar">
              <div class="goal-progress-fill" style="width:${goalPercent}%;background:#8b5cf6"></div>
            </div>
            <div class="goal-details">
              <span>✅ 已达成 ${goal.achieved}</span>
              <span>📈 进行中 ${goal.inProgress}</span>
              ${goal.nearDue > 0 ? `<span style="color:#f59e0b">⚡ 临期 ${goal.nearDue}</span>` : ''}
              ${goal.overdue > 0 ? `<span style="color:#ef4444">⏰ 逾期 ${goal.overdue}</span>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
      <div class="card-actions">
        <button data-action="run" title="按路线顺序开始演练">▶️ 演练</button>
        <button data-action="runs" title="查看演练记录">🕘 记录</button>
        <button data-action="edit" title="编辑路线">✏️ 编辑</button>
        <button data-action="copy" title="复制路线">📋 复制</button>
        <button data-action="archive" title="${isArchived ? '恢复路线' : '归档路线'}">${isArchived ? '↩️ 恢复' : '📦 归档'}</button>
        <button data-action="delete" class="danger" title="删除路线">🗑️ 删除</button>
      </div>
    </div>
  `;
}

function cleanupRouteSteps(route: TrainingRoute): void {
  const validIds = new Set(cards.map((c) => c.id));
  const before = route.stepIds.length;
  route.stepIds = route.stepIds.filter((sid) => validIds.has(sid));
  const removed = before - route.stepIds.length;
  if (removed === 0) {
    toast('没有需要清理的失效步骤', 'info');
    return;
  }
  route.updatedAt = Date.now();
  persist();
  renderRoutes();
  toast(`已清理 ${removed} 个失效步骤`, 'success');
}

function openRouteEditor(route: TrainingRoute | null): void {
  editingRoute = route ? { ...route, stepIds: [...route.stepIds] } : createEmptyRoute();
  const isExisting = route !== null && routes.some((r) => r.id === route.id);
  document.getElementById('route-modal-title')!.textContent = isExisting ? '编辑训练路线' : '新建训练路线';
  (document.getElementById('r-name') as HTMLInputElement).value = editingRoute.name;
  (document.getElementById('r-description') as HTMLTextAreaElement).value = editingRoute.description;
  (document.getElementById('r-target-date') as HTMLInputElement).value = editingRoute.targetDate
    ? new Date(editingRoute.targetDate).toISOString().split('T')[0]
    : '';
  routeStepSearch = '';
  routePickerScope = 'all';
  (document.getElementById('r-step-search') as HTMLInputElement).value = '';
  (document.getElementById('r-picker-scope') as HTMLSelectElement).value = 'all';
  renderRouteStepsEditor();
  openModal('route-modal');
}

function getPickerCards(): PracticeCard[] {
  const scopeCards = routePickerScope === 'filtered' ? filterCards(cards, filterCriteria) : cards;
  const q = routeStepSearch.toLowerCase();
  if (!q) return scopeCards;
  return scopeCards.filter((c) =>
    [c.title, c.zone, ...c.keywords].join(' ').toLowerCase().includes(q)
  );
}

function renderRouteStepsEditor(): void {
  if (!editingRoute) return;
  const stepsEl = document.getElementById('r-steps')!;
  const availEl = document.getElementById('r-available-cards')!;
  const countEl = document.getElementById('r-step-count')!;
  const steps = getRouteCards(editingRoute, cards);
  countEl.textContent = `（${steps.length} 步）`;

  if (steps.length === 0) {
    stepsEl.innerHTML = '<div class="empty-hint route-steps-empty">从右侧勾选讲解条目，组成训练顺序</div>';
  } else {
    stepsEl.innerHTML = steps.map((s, i) => {
      let infoHtml: string;
      if (s.card) {
        const goalStatus = getGoalStatus(s.card);
        infoHtml = `
          <div class="route-step-title">${escapeHtml(s.card.title)}</div>
          <div class="route-step-meta">📍 ${escapeHtml(s.card.zone || '未设展区')} · ⏱️ ${s.card.durationMinutes} 分钟 · <span style="color:${FAMILIARITY_COLORS[s.card.familiarity]}">${FAMILIARITY_LABELS[s.card.familiarity]}</span>${goalStatus !== 'none' ? ` · <span style="color:${GOAL_STATUS_COLORS[goalStatus]}">${GOAL_STATUS_LABELS[goalStatus]}</span>` : ''}</div>`;
      } else {
        infoHtml = `
          <div class="route-step-title">⚠️ 缺失条目</div>
          <div class="route-step-meta">原条目已被删除，可移除</div>`;
      }
      return `
      <div class="route-step-item ${s.card ? '' : 'missing'}" data-index="${i}">
        <span class="route-step-no">${i + 1}</span>
        <div class="route-step-info">${infoHtml}</div>
        <div class="route-step-btns">
          <button type="button" data-move="up" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
          <button type="button" data-move="down" ${i === steps.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          <button type="button" data-move="remove" title="移除">✕</button>
        </div>
      </div>`;
    }).join('');

    stepsEl.querySelectorAll('.route-step-item').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-index')!, 10);
      el.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!editingRoute) return;
          const move = btn.getAttribute('data-move')!;
          if (move === 'remove') {
            editingRoute.stepIds.splice(idx, 1);
          } else if (move === 'up' && idx > 0) {
            [editingRoute.stepIds[idx - 1], editingRoute.stepIds[idx]] = [editingRoute.stepIds[idx], editingRoute.stepIds[idx - 1]];
          } else if (move === 'down' && idx < editingRoute.stepIds.length - 1) {
            [editingRoute.stepIds[idx + 1], editingRoute.stepIds[idx]] = [editingRoute.stepIds[idx], editingRoute.stepIds[idx + 1]];
          }
          renderRouteStepsEditor();
        });
      });
    });
  }

  const inRoute = new Set(editingRoute.stepIds);
  const available = getPickerCards();

  if (available.length === 0) {
    const hint = cards.length === 0
      ? '暂无讲解条目，请先在条目页新建'
      : routePickerScope === 'filtered'
        ? '当前筛选结果为空，可切换为「全部条目」'
        : '没有匹配的条目';
    availEl.innerHTML = `<div class="empty-hint route-steps-empty">${hint}</div>`;
  } else {
    availEl.innerHTML = available.map((c) => {
      const checked = inRoute.has(c.id);
      const goalStatus = getGoalStatus(c);
      return `
      <label class="route-step-item pick ${checked ? 'checked' : ''}" data-id="${c.id}">
        <input type="checkbox" ${checked ? 'checked' : ''} />
        <div class="route-step-info">
          <div class="route-step-title">${escapeHtml(c.title)}</div>
          <div class="route-step-meta">📍 ${escapeHtml(c.zone || '未设展区')} · ⏱️ ${c.durationMinutes} 分钟 · <span style="color:${FAMILIARITY_COLORS[c.familiarity]}">${FAMILIARITY_LABELS[c.familiarity]}</span>${goalStatus !== 'none' ? ` · <span style="color:${GOAL_STATUS_COLORS[goalStatus]}">${GOAL_STATUS_LABELS[goalStatus]}</span>` : ''}</div>
        </div>
      </label>`;
    }).join('');

    availEl.querySelectorAll('.route-step-item').forEach((el) => {
      const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.addEventListener('change', () => {
        if (!editingRoute) return;
        const id = el.getAttribute('data-id')!;
        if (checkbox.checked) {
          if (!editingRoute.stepIds.includes(id)) editingRoute.stepIds.push(id);
        } else {
          editingRoute.stepIds = editingRoute.stepIds.filter((sid) => sid !== id);
        }
        renderRouteStepsEditor();
      });
    });
  }
}

function saveRouteFromForm(): void {
  if (!editingRoute) return;
  const name = (document.getElementById('r-name') as HTMLInputElement).value.trim();
  const description = (document.getElementById('r-description') as HTMLTextAreaElement).value.trim();
  const targetStr = (document.getElementById('r-target-date') as HTMLInputElement).value;

  if (!name) { toast('请填写路线名称', 'error'); return; }
  if (editingRoute.stepIds.length === 0) { toast('请至少添加一个路线步骤', 'error'); return; }

  const now = Date.now();
  editingRoute.name = name;
  editingRoute.description = description;
  editingRoute.targetDate = targetStr ? new Date(targetStr).getTime() : 0;
  editingRoute.updatedAt = now;

  const isNew = !routes.some((r) => r.id === editingRoute!.id);
  if (isNew) {
    routes.push(editingRoute);
  } else {
    const idx = routes.findIndex((r) => r.id === editingRoute!.id);
    if (idx >= 0) routes[idx] = editingRoute;
  }

  persist();
  closeModal('route-modal');
  editingRoute = null;
  renderRoutes();
  toast(isNew ? '已创建训练路线' : '已保存路线修改', 'success');
}

function startRouteRun(route: TrainingRoute): void {
  if (activeRun) {
    toast('已有进行中的演练，请先结束', 'warning');
    return;
  }
  const hasValidStep = getRouteCards(route, cards).some((s) => s.card !== null);
  if (!hasValidStep) {
    toast('路线内没有可演练的有效条目', 'warning');
    return;
  }
  runStepIndex = 0;
  activeRun = {
    id: generateId(),
    routeId: route.id,
    startedAt: Date.now(),
    practicedCardIds: [],
    skippedCardIds: [],
    note: ''
  };
  routeRuns.push(activeRun);
  route.lastRunAt = activeRun.startedAt;
  persist();
  renderRunModal();
  openModal('route-run-modal');
  const closeBtn = document.querySelector('#route-run-modal [data-close]') as HTMLButtonElement | null;
  if (closeBtn) closeBtn.onclick = () => interruptRouteRun();
}

function renderRunModal(): void {
  if (!activeRun) return;
  const route = routes.find((r) => r.id === activeRun!.routeId);
  if (!route) return;
  const run = activeRun;
  const steps = getRouteCards(route, cards);
  const total = steps.length;
  const idx = Math.min(runStepIndex, total - 1);
  const current = steps[idx];
  const summary = calculateRouteSummary(route, cards, routeRuns);

  document.getElementById('route-run-title')!.textContent = `▶️ ${route.name || '路线演练'}`;

  const doneCount = run.practicedCardIds.length + run.skippedCardIds.length;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  document.getElementById('run-header')!.innerHTML = `
    <div class="run-progress-text">
      第 <strong>${idx + 1}</strong> / ${total} 步 · 已讲 ${run.practicedCardIds.length} 条 · 已跳 ${run.skippedCardIds.length} 条 · 路线总时长 ${formatDuration(summary.totalDurationMinutes)}
    </div>
    <div class="goal-progress-bar">
      <div class="goal-progress-fill" style="width:${percent}%;background:var(--success)"></div>
    </div>
  `;

  const practiceBtn = document.getElementById('btn-practice-next') as HTMLButtonElement;
  const currentEl = document.getElementById('run-current')!;

  if (!current || !current.card) {
    currentEl.innerHTML = `
      <div class="run-missing">
        <div class="run-missing-icon">⚠️</div>
        <div class="run-missing-title">条目已不存在</div>
        <div class="run-missing-desc">该步骤引用的讲解条目已被删除，不会阻塞演练，可直接跳过</div>
      </div>
    `;
    practiceBtn.disabled = true;
  } else {
    const c = current.card;
    const famColor = FAMILIARITY_COLORS[c.familiarity];
    const goalProgress = calculateGoalProgress(c);

    let goalHtml = '';
    if (c.stageGoal && goalProgress) {
      const pct = Math.round(goalProgress.overallProgress * 100);
      const gColor = GOAL_STATUS_COLORS[goalProgress.status];
      goalHtml = `
        <div class="section goal-section">
          <div class="section-title">
            🎯 阶段目标
            <span class="goal-status-badge" style="background:${gColor}">${GOAL_STATUS_LABELS[goalProgress.status]}</span>
          </div>
          <div class="goal-progress-bar">
            <div class="goal-progress-fill" style="width:${pct}%;background:${gColor}"></div>
          </div>
          <div class="goal-meta">
            <span class="goal-percent">${pct}%</span>
            <span class="goal-days" style="color:${gColor}">${formatDaysRemaining(goalProgress.daysRemaining)}</span>
          </div>
        </div>
      `;
    }

    currentEl.innerHTML = `
      <div class="run-card">
        <div class="run-card-head">
          <h3 class="card-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title || '(未命名)')}</h3>
          <span class="fam-tag" style="background:${famColor}">${FAMILIARITY_LABELS[c.familiarity]}</span>
        </div>
        <div class="card-meta">
          <span class="zone-tag">📍 ${escapeHtml(c.zone || '未设展区')}</span>
          <span class="duration-tag">⏱️ ${c.durationMinutes} 分钟</span>
          <span class="duration-tag">已试讲 ${c.practiceCount} 次</span>
        </div>
        ${c.keywords.length > 0 ? `
          <div class="section">
            <div class="section-title">🔑 关键词 (${c.keywords.length})</div>
            <div class="tag-cloud">${c.keywords.map((k) => `<span class="tag-item">${escapeHtml(k)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${c.errorPoints.length > 0 ? `
          <div class="section">
            <div class="section-title">⚠️ 易错点 (${c.errorPoints.length})</div>
            <div class="tag-cloud">${c.errorPoints.map((e) => `<span class="tag-item error">${escapeHtml(e)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${c.alternatives.length > 0 ? `
          <div class="section">
            <div class="section-title">💬 替代表达 (${c.alternatives.length})</div>
            <div class="tag-cloud">${c.alternatives.map((a) => `<span class="tag-item alt">${escapeHtml(a)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${goalHtml}
      </div>
    `;
    practiceBtn.disabled = false;
  }

  practiceBtn.textContent = idx === total - 1 ? '🎯 记录试讲并完成' : '🎯 记录试讲并下一条';
}

function practiceCurrentStep(): void {
  if (!activeRun) return;
  const route = routes.find((r) => r.id === activeRun!.routeId);
  if (!route) return;
  const current = getRouteCards(route, cards)[runStepIndex];
  if (!current || !current.card) return;
  const card = cards.find((c) => c.id === current.cardId);
  if (!card) return;

  const now = Date.now();
  card.practiceCount++;
  card.lastPracticedAt = now;
  card.practiceHistory = [...(card.practiceHistory || []), now];
  card.updatedAt = now;
  if (!activeRun.practicedCardIds.includes(card.id)) {
    activeRun.practicedCardIds.push(card.id);
  }
  advanceOrFinishRun();
}

function skipCurrentStep(): void {
  if (!activeRun) return;
  const route = routes.find((r) => r.id === activeRun!.routeId);
  if (!route) return;
  const current = getRouteCards(route, cards)[runStepIndex];
  if (!current) return;
  if (!activeRun.skippedCardIds.includes(current.cardId)) {
    activeRun.skippedCardIds.push(current.cardId);
  }
  advanceOrFinishRun();
}

function advanceOrFinishRun(): void {
  if (!activeRun) return;
  const route = routes.find((r) => r.id === activeRun!.routeId);
  if (!route) return;
  if (runStepIndex >= route.stepIds.length - 1) {
    finishRouteRun();
    return;
  }
  runStepIndex++;
  persist();
  renderRunModal();
}

function finishRouteRun(): void {
  if (!activeRun) return;
  const run = activeRun;
  run.finishedAt = Date.now();
  activeRun = null;
  runStepIndex = 0;
  persist();
  closeModal('route-run-modal');
  render();
  toast(`路线执行完成：试讲 ${run.practicedCardIds.length} 条，跳过 ${run.skippedCardIds.length} 条`, 'success');
}

function interruptRouteRun(): void {
  if (activeRun) {
    const run = activeRun;
    activeRun = null;
    runStepIndex = 0;
    persist();
    if (run.practicedCardIds.length > 0 || run.skippedCardIds.length > 0) {
      toast('演练已中断，已记录的试讲会保留', 'info');
    }
  }
  closeModal('route-run-modal');
  render();
}

function showRouteRuns(route: TrainingRoute): void {
  document.getElementById('route-runs-title')!.textContent = `🕘 演练记录 · ${route.name || '未命名路线'}`;
  const list = routeRuns
    .filter((r) => r.routeId === route.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  const container = document.getElementById('runs-list')!;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">🕘</div><div class="empty-title">暂无演练记录</div><div class="empty-desc">点击路线卡片上的「演练」按钮开始第一次训练</div></div>`;
  } else {
    container.innerHTML = list.map((run) => {
      const usedMinutes = run.finishedAt ? Math.max(1, Math.round((run.finishedAt - run.startedAt) / 60000)) : 0;
      return `
        <div class="run-record ${run.finishedAt ? '' : 'unfinished'}">
          <div class="run-record-head">
            <span class="run-record-time">${formatDateTime(run.startedAt)}${run.finishedAt ? ` ~ ${formatDateTime(run.finishedAt)}` : ''}</span>
            <span class="badge ${run.finishedAt ? 'reviewed' : 'not-reviewed'}">${run.finishedAt ? '✅ 已完成' : '⏳ 未完成'}</span>
          </div>
          <div class="run-record-meta">试讲 ${run.practicedCardIds.length} 条 · 跳过 ${run.skippedCardIds.length} 条${run.finishedAt ? ` · 用时 ${formatDuration(usedMinutes)}` : ''}</div>
          ${run.note ? `<div class="run-record-note">${escapeHtml(run.note)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  openModal('route-runs-modal');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function bindEvents(): void {
  document.getElementById('btn-add')!.addEventListener('click', () => openCardEditor(null));
  document.getElementById('btn-save-card')!.addEventListener('click', saveCardFromForm);

  document.getElementById('btn-check')!.addEventListener('click', showCheckResults);
  document.getElementById('btn-daily-plan')!.addEventListener('click', showDailyPlan);

  document.getElementById('btn-export-json')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0 && routes.length === 0) { toast('暂无可导出内容', 'warning'); return; }
    const content = exportToJson(list, routes, routeRuns);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.json`, 'application/json');
    toast(`已导出 ${list.length} 个条目、${routes.length} 条路线为 JSON`, 'success');
  });

  document.getElementById('btn-export-md')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0 && routes.length === 0) { toast('暂无可导出内容', 'warning'); return; }
    const content = exportToMarkdown(list, routes, routeRuns);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.md`, 'text/markdown');
    toast(`已导出 ${list.length} 个条目、${routes.length} 条路线为 Markdown`, 'success');
  });

  document.getElementById('btn-reset-filter')!.addEventListener('click', () => {
    filterCriteria.zones = [];
    filterCriteria.familiarity = [];
    filterCriteria.minDuration = null;
    filterCriteria.maxDuration = null;
    filterCriteria.hasErrorPoints = 'all';
    filterCriteria.isReviewed = 'all';
    filterCriteria.goalStatus = [];
    filterCriteria.searchText = '';
    (document.getElementById('filter-search') as HTMLInputElement).value = '';
    (document.getElementById('filter-min-dur') as HTMLInputElement).value = '';
    (document.getElementById('filter-max-dur') as HTMLInputElement).value = '';
    (document.getElementById('filter-has-errors') as HTMLSelectElement).value = 'all';
    (document.getElementById('filter-is-reviewed') as HTMLSelectElement).value = 'all';
    document.querySelectorAll('#filter-familiarity input[type="checkbox"]').forEach((cb) => {
      (cb as HTMLInputElement).checked = false;
    });
    document.querySelectorAll('#filter-goal-status input[type="checkbox"]').forEach((cb) => {
      (cb as HTMLInputElement).checked = false;
    });
    render();
  });

  const searchInput = document.getElementById('filter-search') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    filterCriteria.searchText = searchInput.value.trim();
    renderCards();
    renderBatchPanel();
  });

  document.querySelectorAll('#filter-familiarity input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value as FamiliarityLevel;
      if ((e.target as HTMLInputElement).checked) {
        if (!filterCriteria.familiarity.includes(val)) filterCriteria.familiarity.push(val);
      } else {
        filterCriteria.familiarity = filterCriteria.familiarity.filter((f) => f !== val);
      }
      renderCards();
      renderBatchPanel();
    });
  });

  document.querySelectorAll('#filter-goal-status input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value as GoalStatus;
      if ((e.target as HTMLInputElement).checked) {
        if (!filterCriteria.goalStatus.includes(val)) filterCriteria.goalStatus.push(val);
      } else {
        filterCriteria.goalStatus = filterCriteria.goalStatus.filter((s) => s !== val);
      }
      renderCards();
      renderBatchPanel();
    });
  });

  const minDur = document.getElementById('filter-min-dur') as HTMLInputElement;
  const maxDur = document.getElementById('filter-max-dur') as HTMLInputElement;
  const updateDuration = () => {
    const min = parseInt(minDur.value, 10);
    const max = parseInt(maxDur.value, 10);
    filterCriteria.minDuration = isNaN(min) ? null : min;
    filterCriteria.maxDuration = isNaN(max) ? null : max;
    renderCards();
    renderBatchPanel();
  };
  minDur.addEventListener('input', updateDuration);
  maxDur.addEventListener('input', updateDuration);

  (document.getElementById('filter-has-errors') as HTMLSelectElement).addEventListener('change', (e) => {
    filterCriteria.hasErrorPoints = (e.target as HTMLSelectElement).value as FilterCriteria['hasErrorPoints'];
    renderCards();
    renderBatchPanel();
  });

  (document.getElementById('filter-is-reviewed') as HTMLSelectElement).addEventListener('change', (e) => {
    filterCriteria.isReviewed = (e.target as HTMLSelectElement).value as FilterCriteria['isReviewed'];
    renderCards();
    renderBatchPanel();
  });

  (document.getElementById('sort-by') as HTMLSelectElement).addEventListener('change', (e) => {
    sortBy = (e.target as HTMLSelectElement).value;
    renderCards();
  });
  (document.getElementById('sort-order') as HTMLSelectElement).addEventListener('change', (e) => {
    sortOrder = (e.target as HTMLSelectElement).value as 'asc' | 'desc';
    renderCards();
  });

  document.getElementById('btn-batch-apply')!.addEventListener('click', applyBatchChanges);

  document.getElementById('tab-cards')!.addEventListener('click', () => switchView('cards'));
  document.getElementById('tab-routes')!.addEventListener('click', () => switchView('routes'));
  document.getElementById('btn-add-route')!.addEventListener('click', () => openRouteEditor(null));
  document.getElementById('btn-recommend-route')!.addEventListener('click', () => {
    const draft = generateRecommendedRoute(cards, routes, routeRuns);
    if (draft.stepIds.length === 0) {
      toast('今天没有需要重点训练的条目，继续保持', 'info');
      return;
    }
    openRouteEditor(draft);
    toast(`已生成 ${draft.stepIds.length} 步推荐路线，可调整顺序后保存`, 'success');
  });
  document.getElementById('btn-save-route')!.addEventListener('click', saveRouteFromForm);
  document.getElementById('btn-practice-next')!.addEventListener('click', practiceCurrentStep);
  document.getElementById('btn-skip-step')!.addEventListener('click', skipCurrentStep);
  document.getElementById('btn-end-run')!.addEventListener('click', finishRouteRun);

  (document.getElementById('route-sort-by') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortBy = (e.target as HTMLSelectElement).value as RouteSortBy;
    renderRoutes();
  });
  (document.getElementById('route-sort-order') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortOrder = (e.target as HTMLSelectElement).value as 'asc' | 'desc';
    renderRoutes();
  });

  (document.getElementById('r-step-search') as HTMLInputElement).addEventListener('input', (e) => {
    routeStepSearch = (e.target as HTMLInputElement).value.trim();
    renderRouteStepsEditor();
  });

  (document.getElementById('r-picker-scope') as HTMLSelectElement).addEventListener('change', (e) => {
    routePickerScope = (e.target as HTMLSelectElement).value as 'filtered' | 'all';
    renderRouteStepsEditor();
  });

  document.getElementById('btn-add-all-listed')!.addEventListener('click', () => {
    if (!editingRoute) return;
    let added = 0;
    getPickerCards().forEach((c) => {
      if (!editingRoute!.stepIds.includes(c.id)) {
        editingRoute!.stepIds.push(c.id);
        added++;
      }
    });
    renderRouteStepsEditor();
    toast(added > 0 ? `已加入 ${added} 个条目` : '列表中的条目均已在路线内', added > 0 ? 'success' : 'info');
  });
  document.getElementById('btn-select-all')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    list.forEach((c) => selectedIds.add(c.id));
    persist();
    render();
  });
  document.getElementById('btn-clear-select')!.addEventListener('click', () => {
    selectedIds.clear();
    persist();
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const backdrop = document.getElementById('modal-backdrop')!;
      if (backdrop.style.display === 'flex') {
        ['card-modal', 'daily-modal', 'check-modal', 'route-modal', 'route-run-modal', 'route-runs-modal', 'confirm-modal'].forEach((id) => {
          const m = document.getElementById(id);
          if (m && m.style.display === 'flex') {
            if (id === 'route-run-modal') interruptRouteRun();
            else closeModal(id);
          }
        });
      }
    }
  });
}

function init(): void {
  cards = loadCards();
  selectedIds = loadSelectedIds();
  routes = loadRoutes();
  routeRuns = loadRouteRuns();
  bindEvents();
  switchView('cards');
  render();

  const quickCheck = runChecks(cards).filter((r) => r.severity !== 'info');
  if (quickCheck.length > 0) {
    setTimeout(() => {
      toast(`检测到 ${quickCheck.length} 项内容检查待关注，点击「内容检查」查看详情`, 'warning');
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', init);
