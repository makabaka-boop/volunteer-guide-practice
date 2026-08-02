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
  RouteRunRecord
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
  getRouteMissingStepIds,
  cleanRouteMissingSteps,
  calculateRouteSummary,
  sortRoutes,
  startRouteRun,
  sortCardsByZoneOrder,
  DEFAULT_ROUTE_ZONE_ORDER,
  generateRecommendedRoute,
  type RouteSortKey
} from './utils';

let cards: PracticeCard[] = [];
let selectedIds: Set<string> = new Set();
let editingCard: PracticeCard | null = null;
let sortBy: string = 'updated';
let sortOrder: 'asc' | 'desc' = 'desc';

let routes: TrainingRoute[] = [];
let routeRuns: RouteRunRecord[] = [];
let editingRoute: TrainingRoute | null = null;
let activeRun: RouteRunRecord | null = null;
let activeRunRouteId: string | null = null;
let currentStepIndex: number = 0;
let routeSortBy: RouteSortKey = 'targetDate';
let routeSortOrder: 'asc' | 'desc' = 'asc';
let pickerSource: 'filtered' | 'all' = 'filtered';
let pickerSearch: string = '';

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
  if (modalId === 'route-runner-modal' && activeRun) {
    activeRun = null;
    activeRunRouteId = null;
    currentStepIndex = 0;
    render();
  }
  if (modalId === 'route-editor-modal') {
    editingRoute = null;
  }
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
  renderRouteStats();
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
        toast('已删除', 'success');
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
  document.querySelectorAll('.view-tab').forEach((t) => {
    t.classList.toggle('active', (t as HTMLElement).dataset.view === view);
  });
  const cardsView = document.getElementById('cards-view')!;
  const routesView = document.getElementById('routes-view')!;
  const cardsSidebar = document.getElementById('cards-sidebar')!;
  const routesSidebar = document.getElementById('routes-sidebar')!;
  if (view === 'cards') {
    cardsView.style.display = 'flex';
    routesView.style.display = 'none';
    cardsSidebar.style.display = 'block';
    routesSidebar.style.display = 'none';
  } else {
    cardsView.style.display = 'none';
    routesView.style.display = 'flex';
    cardsSidebar.style.display = 'none';
    routesSidebar.style.display = 'block';
  }
}

function renderRouteStats(): void {
  const container = document.getElementById('route-stats')!;
  const activeCount = routes.filter((r) => !r.archivedAt).length;
  const archivedCount = routes.length - activeCount;
  const totalRuns = routeRuns.filter((r) => r.finishedAt).length;
  const missingCount = routes.reduce((sum, r) => sum + getRouteMissingStepIds(r, cards).length, 0);
  const totalGoals = routes.reduce((sum, r) => {
    const s = calculateRouteSummary(r, cards, routeRuns);
    return sum + s.goalSummaries.length;
  }, 0);
  const achievedGoals = routes.reduce((sum, r) => {
    const s = calculateRouteSummary(r, cards, routeRuns);
    return sum + s.achievedGoalCount;
  }, 0);

  container.innerHTML = `
    <div class="stat-item"><div class="stat-value">${routes.length}</div><div class="stat-label">路线总数</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#4f46e5">${activeCount}</div><div class="stat-label">进行中</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#10b981">${totalRuns}</div><div class="stat-label">完成执行</div></div>
    <div class="stat-item"><div class="stat-value" style="color:#${missingCount > 0 ? 'ef4444' : '94a3b8'}">${missingCount}</div><div class="stat-label">缺失步骤</div></div>
    ${totalGoals > 0 ? `<div class="stat-item"><div class="stat-value" style="color:#10b981">${achievedGoals}/${totalGoals}</div><div class="stat-label">🎯 目标达成</div></div>` : ''}
    ${archivedCount > 0 ? `<div class="stat-item"><div class="stat-value" style="color:#94a3b8">${archivedCount}</div><div class="stat-label">已归档</div></div>` : ''}
  `;
}

function getSortedRoutes(): TrainingRoute[] {
  return sortRoutes(routes, cards, routeRuns, routeSortBy, routeSortOrder);
}

function renderRoutes(): void {
  const container = document.getElementById('routes-container')!;
  const empty = document.getElementById('routes-empty-state')!;
  const info = document.getElementById('routes-info')!;
  const list = getSortedRoutes();

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    info.innerHTML = '暂无训练路线';
    return;
  }
  empty.style.display = 'none';
  const activeCount = list.filter((r) => !r.archivedAt).length;
  const totalSteps = list.reduce((s, r) => s + r.stepIds.length, 0);
  info.innerHTML = `共 <strong>${list.length}</strong> 条路线（进行中 ${activeCount}），累计 <strong>${totalSteps}</strong> 个步骤`;

  container.innerHTML = list.map(renderRouteCardHtml).join('');

  container.querySelectorAll('.route-card').forEach((el) => {
    const id = el.getAttribute('data-id')!;
    const route = routes.find((r) => r.id === id);
    if (!route) return;

    el.querySelector('[data-route-action="run"]')?.addEventListener('click', () => startRouteRunner(route));
    el.querySelector('[data-route-action="edit"]')?.addEventListener('click', () => openRouteEditor(route));
    el.querySelector('[data-route-action="copy"]')?.addEventListener('click', () => {
      const copied = cloneRoute(route);
      routes.push(copied);
      persist();
      render();
      toast(`已复制路线「${route.name}」`, 'success');
    });
    el.querySelector('[data-route-action="detail"]')?.addEventListener('click', () => showRouteDetail(route));
    el.querySelector('[data-route-action="archive"]')?.addEventListener('click', () => toggleArchiveRoute(route));
    el.querySelector('[data-route-action="delete"]')?.addEventListener('click', () => {
      showConfirm('删除路线', `确认删除路线「${route.name}」？相关执行记录也会一并删除，此操作不可恢复。`, () => {
        routes = routes.filter((r) => r.id !== id);
        routeRuns = routeRuns.filter((r) => r.routeId !== id);
        persist();
        render();
        toast('已删除路线', 'success');
      });
    });
    el.querySelector('[data-route-action="clean-missing"]')?.addEventListener('click', () => {
      const missing = getRouteMissingStepIds(route, cards);
      showConfirm('清理无效步骤', `将从路线中移除 ${missing.length} 个已失效的条目引用，确认继续？`, () => {
        const idx = routes.findIndex((r) => r.id === id);
        if (idx >= 0) {
          routes[idx] = cleanRouteMissingSteps(route, cards);
          persist();
          render();
          toast(`已清理 ${missing.length} 个无效步骤`, 'success');
        }
      });
    });
  });
}

function renderRouteCardHtml(route: TrainingRoute): string {
  const summary = calculateRouteSummary(route, cards, routeRuns);
  const refs = getRouteCards(route, cards);
  const now = Date.now();
  const DAY = 86400000;
  const daysToTarget = Math.ceil((route.targetDate - now) / DAY);
  let targetClass = 'target';
  let targetText = formatDate(route.targetDate);
  if (!route.archivedAt) {
    if (daysToTarget < 0) { targetClass += ' overdue'; targetText = `已逾期 ${Math.abs(daysToTarget)} 天`; }
    else if (daysToTarget <= 3) { targetClass += ' near'; targetText = `${daysToTarget === 0 ? '今天' : daysToTarget + ' 天后'}截止`; }
    else { targetText = `${daysToTarget} 天后截止`; }
  }

  const previewRefs = refs.slice(0, 4);
  const extraCount = refs.length - previewRefs.length;
  const goalChips: string[] = [];
  if (summary.goalSummaries.length > 0) {
    goalChips.push(`<span class="route-goal-chip achieved">✅ ${summary.achievedGoalCount} 已达成</span>`);
    if (summary.overdueGoalCount > 0) goalChips.push(`<span class="route-goal-chip overdue">⏰ ${summary.overdueGoalCount} 逾期</span>`);
    if (summary.nearDueGoalCount > 0) goalChips.push(`<span class="route-goal-chip near">⚡ ${summary.nearDueGoalCount} 临期</span>`);
    const otherActive = summary.activeGoalCount - summary.overdueGoalCount - summary.nearDueGoalCount;
    if (otherActive > 0) goalChips.push(`<span class="route-goal-chip active">🎯 ${otherActive} 进行中</span>`);
  }

  const alertChips: string[] = [];
  if (summary.unreviewedCount > 0) alertChips.push(`<span class="route-meta-pill unreviewed" title="未复盘条目数">📝 ${summary.unreviewedCount} 待复盘</span>`);
  if (summary.missingCount > 0) alertChips.push(`<span class="route-meta-pill missing" title="缺失条目数">⚠️ ${summary.missingCount} 缺失</span>`);

  return `
    <div class="route-card ${route.archivedAt ? 'archived' : ''}" data-id="${route.id}">
      <div class="route-card-header">
        <h3 title="${escapeHtml(route.name)}">${escapeHtml(route.name || '(未命名路线)')}</h3>
      </div>
      ${route.description ? `<div class="route-card-desc">${escapeHtml(route.description)}</div>` : '<div class="route-card-desc"></div>'}
      <div class="route-meta-row">
        <span class="route-meta-pill ${targetClass}">📅 ${targetText}</span>
        <span class="route-meta-pill">🧭 ${summary.validSteps}/${summary.totalSteps} 步</span>
        <span class="route-meta-pill duration">⏱️ ${formatDuration(summary.totalDurationMinutes)}</span>
        ${alertChips.join('')}
        ${summary.runCount > 0 ? `<span class="route-meta-pill done">▶️ 已练 ${summary.runCount} 次</span>` : ''}
        ${summary.lastRunAt ? `<span class="route-meta-pill">最近 ${formatDate(summary.lastRunAt)}</span>` : ''}
      </div>
      ${goalChips.length > 0 ? `<div class="route-goal-strip">${goalChips.join('')}</div>` : ''}
      ${summary.missingStepIds.length > 0 ? `
        <div class="route-missing-banner">
          <span>⚠️ 检测到 ${summary.missingStepIds.length} 个条目已被删除，步骤引用失效</span>
          <button data-route-action="clean-missing">一键清理</button>
        </div>
      ` : ''}
      <div class="route-steps-preview">
        ${previewRefs.map((ref, idx) => `
          <div class="route-step-preview-item ${ref.missing ? 'missing' : ''}">
            <span class="route-step-idx">${idx + 1}</span>
            <span class="route-step-name">${ref.missing ? `缺失条目（${ref.cardId.slice(0, 8)}）` : escapeHtml(ref.card!.title)}</span>
          </div>
        `).join('')}
        ${extraCount > 0 ? `<div class="route-step-more">…还有 ${extraCount} 个步骤</div>` : ''}
      </div>
      <div class="route-actions">
        <button class="success" data-route-action="run" ${summary.validSteps === 0 ? 'disabled' : ''}>▶️ 开始执行</button>
        <button class="primary" data-route-action="edit">✏️ 编辑</button>
        <button data-route-action="detail">📄 详情</button>
        <button data-route-action="copy">📋 复制</button>
        <button data-route-action="archive">${route.archivedAt ? '📤 恢复' : '📥 归档'}</button>
        <button class="danger" data-route-action="delete">🗑️ 删除</button>
      </div>
    </div>
  `;
}

function getPickerCards(): PracticeCard[] {
  const source = pickerSource === 'filtered' ? getFilteredSortedCards() : cards;
  let result = source.filter((c) => c.title.trim());
  if (pickerSearch) {
    const q = pickerSearch.toLowerCase();
    result = result.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.zone.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }
  return result;
}

function quickCreateZoneRoute(): void {
  const matched = cards.filter((c) => c.title.trim() && DEFAULT_ROUTE_ZONE_ORDER.includes(c.zone));
  if (matched.length === 0) {
    toast(`未找到属于「${DEFAULT_ROUTE_ZONE_ORDER.join('、')}」的条目，无法快速生成`, 'warning');
    return;
  }
  const ordered = sortCardsByZoneOrder(matched, DEFAULT_ROUTE_ZONE_ORDER);
  const zonesFound = Array.from(new Set(ordered.map((c) => c.zone)));
  const route = createEmptyRoute();
  route.name = `全馆路线（${zonesFound.join('→')}）`;
  route.description = `排练前快速生成，按 ${zonesFound.join('、')} 顺序串联，共 ${ordered.length} 个条目。`;
  route.stepIds = ordered.map((c) => c.id);
  routes.push(route);
  persist();
  render();
  toast(`已按展区顺序生成路线，包含 ${ordered.length} 个条目`, 'success');
}

function generateTodayRoute(): void {
  const draft = generateRecommendedRoute(cards, routes, routeRuns);
  if (draft.stepIds.length === 0) {
    toast('当前没有符合推荐条件的条目，无法生成今日重点路线', 'warning');
    return;
  }
  toast(`已根据复盘状态、掌握度、目标与练习情况推荐 ${draft.stepIds.length} 个条目，可在弹窗中调整顺序后保存`, 'info');
  openRouteEditor(draft);
}

function openRouteEditor(route: TrainingRoute | null): void {
  editingRoute = route ? { ...route, stepIds: [...route.stepIds] } : createEmptyRoute();
  const isExisting = route ? routes.some((r) => r.id === route.id) : false;
  if (!route) {
    document.getElementById('route-editor-title')!.textContent = '新建训练路线';
  } else if (!isExisting) {
    document.getElementById('route-editor-title')!.textContent = '预览今日重点路线（调整后保存）';
  } else {
    document.getElementById('route-editor-title')!.textContent = '编辑训练路线';
  }

  (document.getElementById('rf-name') as HTMLInputElement).value = editingRoute.name;
  (document.getElementById('rf-description') as HTMLTextAreaElement).value = editingRoute.description;
  const dueDate = new Date(editingRoute.targetDate);
  (document.getElementById('rf-target-date') as HTMLInputElement).value = dueDate.toISOString().split('T')[0];
  (document.getElementById('rf-archived') as HTMLSelectElement).value = editingRoute.archivedAt ? 'yes' : 'no';

  pickerSource = 'filtered';
  pickerSearch = '';
  (document.getElementById('rf-picker-search') as HTMLInputElement).value = '';
  document.querySelectorAll<HTMLInputElement>('input[name="rf-picker-source"]').forEach((r) => {
    r.checked = r.value === 'filtered';
  });

  renderRoutePicker();
  renderRouteStepList();
  openModal('route-editor-modal');
}

function renderRoutePicker(): void {
  if (!editingRoute) return;
  const listEl = document.getElementById('rf-available-list')!;
  const countEl = document.getElementById('rf-available-count')!;
  const selectedSet = new Set(editingRoute.stepIds);
  const pickerCards = getPickerCards();
  countEl.textContent = String(pickerCards.length);

  if (pickerCards.length === 0) {
    listEl.innerHTML = '<div class="route-picker-empty">没有可选条目，请调整筛选条件或切换到「全部条目」</div>';
    return;
  }

  listEl.innerHTML = pickerCards.map((card) => {
    const checked = selectedSet.has(card.id);
    const goalStatus = getGoalStatus(card);
    const famColor = FAMILIARITY_COLORS[card.familiarity];
    const goalColor = GOAL_STATUS_COLORS[goalStatus];
    const goalLabel = GOAL_STATUS_LABELS[goalStatus];
    return `
      <label class="picker-card ${checked ? 'selected' : ''}" data-card-id="${card.id}">
        <input type="checkbox" ${checked ? 'checked' : ''} data-picker-check="${card.id}" />
        <div class="picker-card-info">
          <div class="picker-card-title">${escapeHtml(card.title)}</div>
          <div class="picker-card-meta">
            <span class="zone-tag">📍 ${escapeHtml(card.zone || '未设展区')}</span>
            <span>⏱️ ${card.durationMinutes}分</span>
            <span class="fam-tag" style="background:${famColor}">${FAMILIARITY_LABELS[card.familiarity]}</span>
            ${card.stageGoal ? `<span class="picker-goal-dot" style="background:${goalColor}" title="目标：${goalLabel}"></span>` : ''}
            ${!card.isReviewed && card.practiceCount > 0 ? '<span class="picker-flag review">待复盘</span>' : ''}
          </div>
        </div>
      </label>
    `;
  }).join('');

  listEl.querySelectorAll<HTMLInputElement>('[data-picker-check]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (!editingRoute) return;
      const cardId = (e.target as HTMLInputElement).getAttribute('data-picker-check')!;
      if ((e.target as HTMLInputElement).checked) {
        if (!editingRoute.stepIds.includes(cardId)) editingRoute.stepIds.push(cardId);
      } else {
        editingRoute.stepIds = editingRoute.stepIds.filter((id) => id !== cardId);
      }
      renderRoutePicker();
      renderRouteStepList();
    });
  });
}

function renderRouteStepList(): void {
  if (!editingRoute) return;
  const listEl = document.getElementById('rf-step-list')!;
  const countEl = document.getElementById('rf-selected-count')!;
  const refs = getRouteCards(editingRoute, cards);
  countEl.textContent = String(refs.length);
  if (refs.length === 0) {
    listEl.innerHTML = '<div class="route-picker-empty">从左侧勾选条目加入路线</div>';
    return;
  }
  listEl.innerHTML = refs.map((ref, idx) => {
    if (ref.missing) {
      return `
        <div class="route-step-item missing" data-idx="${idx}">
          <span class="idx">!</span>
          <span class="name">⚠️ 缺失条目（ID: ${ref.cardId.slice(0, 8)}）<small>条目已删除</small></span>
          <span class="step-btns">
            <button class="del" data-step-action="remove" title="移除">✕</button>
          </span>
        </div>
      `;
    }
    const card = ref.card!;
    const famColor = FAMILIARITY_COLORS[card.familiarity];
    const goalStatus = getGoalStatus(card);
    const goalColor = GOAL_STATUS_COLORS[goalStatus];
    const goalLabel = GOAL_STATUS_LABELS[goalStatus];
    return `
      <div class="route-step-item" data-idx="${idx}">
        <span class="idx">${idx + 1}</span>
        <span class="name">${escapeHtml(card.title)}
          <small>📍 ${escapeHtml(card.zone || '未设展区')} · ⏱️ ${card.durationMinutes}分</small>
          <small class="step-tags">
            <span class="fam-tag" style="background:${famColor}">${FAMILIARITY_LABELS[card.familiarity]}</span>
            ${card.stageGoal ? `<span class="step-goal" style="color:${goalColor};border-color:${goalColor}">🎯 ${goalLabel}</span>` : ''}
            ${!card.isReviewed ? '<span class="step-flag">待复盘</span>' : ''}
          </small>
        </span>
        <span class="step-btns">
          <button data-step-action="up" title="上移">↑</button>
          <button data-step-action="down" title="下移">↓</button>
          <button class="del" data-step-action="remove" title="移除">✕</button>
        </span>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.route-step-item').forEach((itemEl) => {
    const idx = parseInt(itemEl.getAttribute('data-idx')!, 10);
    itemEl.querySelector('[data-step-action="up"]')?.addEventListener('click', () => {
      if (!editingRoute || idx <= 0) return;
      const ids = editingRoute.stepIds;
      [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      renderRouteStepList();
    });
    itemEl.querySelector('[data-step-action="down"]')?.addEventListener('click', () => {
      if (!editingRoute) return;
      const ids = editingRoute.stepIds;
      if (idx >= ids.length - 1) return;
      [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
      renderRouteStepList();
    });
    itemEl.querySelector('[data-step-action="remove"]')!.addEventListener('click', () => {
      if (!editingRoute) return;
      editingRoute.stepIds.splice(idx, 1);
      renderRoutePicker();
      renderRouteStepList();
    });
  });
}

function saveRouteFromForm(): void {
  if (!editingRoute) return;
  const name = (document.getElementById('rf-name') as HTMLInputElement).value.trim();
  if (!name) { toast('请填写路线名称', 'error'); return; }
  const desc = (document.getElementById('rf-description') as HTMLTextAreaElement).value.trim();
  const dateStr = (document.getElementById('rf-target-date') as HTMLInputElement).value;
  const archivedVal = (document.getElementById('rf-archived') as HTMLSelectElement).value;

  if (!dateStr) { toast('请选择目标日期', 'error'); return; }

  const now = Date.now();
  const isNew = !routes.some((r) => r.id === editingRoute!.id);
  editingRoute.name = name;
  editingRoute.description = desc;
  editingRoute.targetDate = new Date(dateStr).getTime();
  if (archivedVal === 'yes' && !editingRoute.archivedAt) {
    editingRoute.archivedAt = now;
  } else if (archivedVal === 'no' && editingRoute.archivedAt) {
    editingRoute.archivedAt = undefined;
  }
  editingRoute.updatedAt = now;

  if (isNew) {
    routes.push(editingRoute);
  } else {
    const idx = routes.findIndex((r) => r.id === editingRoute!.id);
    if (idx >= 0) routes[idx] = editingRoute;
  }

  persist();
  closeModal('route-editor-modal');
  editingRoute = null;
  render();
  toast(isNew ? '路线已创建' : '路线已保存', 'success');
}

function toggleArchiveRoute(route: TrainingRoute): void {
  const idx = routes.findIndex((r) => r.id === route.id);
  if (idx < 0) return;
  const now = Date.now();
  if (routes[idx].archivedAt) {
    routes[idx].archivedAt = undefined;
    toast('已恢复路线', 'success');
  } else {
    routes[idx].archivedAt = now;
    toast('路线已归档', 'info');
  }
  routes[idx].updatedAt = now;
  persist();
  render();
}

function getActiveRoute(): TrainingRoute | null {
  if (!activeRunRouteId) return null;
  return routes.find((r) => r.id === activeRunRouteId) || null;
}

function startRouteRunner(route: TrainingRoute): void {
  const refs = getRouteCards(route, cards);
  if (refs.length === 0) {
    toast('该路线没有任何步骤，无法执行', 'warning');
    return;
  }
  activeRun = startRouteRun(route.id);
  activeRunRouteId = route.id;
  currentStepIndex = 0;
  document.getElementById('route-runner-title')!.textContent = `按顺序试讲：${route.name}`;
  renderRouteRunner();
  openModal('route-runner-modal');
}

function recordCardPractice(card: PracticeCard): void {
  const now = Date.now();
  card.practiceCount++;
  card.lastPracticedAt = now;
  card.practiceHistory = [...(card.practiceHistory || []), now];
  card.updatedAt = now;
}

function renderRunnerGoalSection(card: PracticeCard): string {
  const goalProgress = calculateGoalProgress(card);
  if (!card.stageGoal || !goalProgress) return '';
  const progressPercent = Math.round(goalProgress.overallProgress * 100);
  const daysText = formatDaysRemaining(goalProgress.daysRemaining);
  const statusLabel = GOAL_STATUS_LABELS[goalProgress.status];
  const goalColor = GOAL_STATUS_COLORS[goalProgress.status];
  return `
    <div class="section goal-section runner-goal-section">
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
        <span title="目标试讲次数">🎯 ${card.stageGoal.targetPracticeCount} 次（已练 ${card.practiceCount}）</span>
        ${card.stageGoal.targetReviewDone ? `<span title="需复盘">📝 ${card.isReviewed ? '已复盘' : '待复盘'}</span>` : ''}
      </div>
    </div>
  `;
}

function renderRunnerCardDetail(card: PracticeCard): string {
  return `
    <div class="runner-card-detail">
      <div class="runner-card-head">
        <h3>${escapeHtml(card.title || '(未命名)')}</h3>
        <div class="runner-card-meta">
          ${card.zone ? `<span class="zone-tag">📍 ${escapeHtml(card.zone)}</span>` : ''}
          <span class="duration-tag">⏱️ ${card.durationMinutes} 分钟</span>
          <span class="fam-tag fam-${card.familiarity}" style="background:${FAMILIARITY_COLORS[card.familiarity]}">${FAMILIARITY_LABELS[card.familiarity]}</span>
          <span>🎤 已试讲 ${card.practiceCount} 次</span>
        </div>
      </div>
      ${renderRunnerGoalSection(card)}
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
  `;
}

function renderRouteRunner(): void {
  const route = getActiveRoute();
  if (!activeRun || !route) return;

  const refs = getRouteCards(route, cards);
  const totalValid = refs.filter((r) => !r.missing).length;
  const practiced = new Set(activeRun.practicedCardIds);
  const skipped = new Set(activeRun.skippedCardIds);
  const totalDuration = refs
    .filter((r) => !r.missing && r.card)
    .reduce((sum, r) => sum + (r.card ? r.card.durationMinutes : 0), 0);
  const handledCount = practiced.size + skipped.size;

  const progressEl = document.getElementById('route-runner-progress')!;
  const currentEl = document.getElementById('route-runner-current')!;
  const statusEl = document.getElementById('route-runner-status')!;
  const nextBtn = document.getElementById('btn-next-route-step') as HTMLButtonElement;
  const skipBtn = document.getElementById('btn-skip-route-step') as HTMLButtonElement;
  const endBtn = document.getElementById('btn-end-route-run') as HTMLButtonElement;
  endBtn.style.display = 'inline-flex';
  endBtn.textContent = '结束路线';

  progressEl.innerHTML = `
    <div class="runner-progress-info">
      <span class="runner-route-name">${escapeHtml(route.name || '(未命名路线)')}</span>
      <span class="runner-progress-text">进度 ${handledCount} / ${totalValid}${refs.length !== totalValid ? `（含 ${refs.length - totalValid} 个缺失）` : ''}</span>
    </div>
    <div class="runner-progress-bar">
      <div class="runner-progress-fill" style="width:${totalValid > 0 ? (handledCount / totalValid) * 100 : 0}%"></div>
    </div>
    <div class="runner-progress-meta">
      <span>⏱️ 预计总时长 ${formatDuration(totalDuration)}</span>
      <span>✅ 已练 ${practiced.size}</span>
      <span>⏭️ 跳过 ${skipped.size}</span>
    </div>
  `;

  if (currentStepIndex >= refs.length) {
    currentEl.innerHTML = `
      <div class="runner-complete">
        <div class="runner-complete-icon">🎉</div>
        <h3>路线已完成</h3>
        <p>共处理 ${handledCount} 个条目：已练 ${practiced.size}，跳过 ${skipped.size}</p>
        <div class="form-field" style="margin-top:16px;text-align:left">
          <label>本次执行备注</label>
          <textarea id="rr-note" rows="3" placeholder="记录本次试讲的整体感受、问题...">${escapeHtml(activeRun.note)}</textarea>
        </div>
      </div>
    `;
    statusEl.innerHTML = '';
    nextBtn.style.display = 'none';
    skipBtn.style.display = 'none';
    endBtn.textContent = '完成并保存记录';
    endBtn.classList.add('btn-success');
    endBtn.classList.remove('btn-outline');
    const noteEl = document.getElementById('rr-note') as HTMLTextAreaElement | null;
    if (noteEl) {
      noteEl.addEventListener('input', () => {
        if (activeRun) activeRun.note = noteEl.value;
      });
    }
    return;
  }

  const ref = refs[currentStepIndex];
  const isMissing = ref.missing;
  const stepNumber = currentStepIndex + 1;
  const isPracticed = practiced.has(ref.cardId);
  const isSkipped = skipped.has(ref.cardId);

  currentEl.innerHTML = isMissing
    ? `
      <div class="runner-missing">
        <div class="runner-step-badge">第 ${stepNumber} / ${refs.length} 步</div>
        <div class="runner-missing-icon">❓</div>
        <h3>条目已不存在</h3>
        <p>该步骤引用的讲解条目（ID: ${ref.cardId.slice(0, 10)}）已被删除，无法进行试讲。</p>
        <p class="runner-missing-hint">请点击「跳过」继续下一条；路线结束后可使用「一键清理」移除这些失效引用。</p>
      </div>
    `
    : `
      <div class="runner-current-wrapper">
        <div class="runner-step-badge">第 ${stepNumber} / ${refs.length} 步</div>
        ${renderRunnerCardDetail(ref.card!)}
      </div>
    `;

  statusEl.innerHTML = `
    <div class="runner-step-status-row">
      ${isPracticed ? '<span class="runner-status-chip done">✓ 已记录试讲</span>' : ''}
      ${isSkipped ? '<span class="runner-status-chip skipped">⏭️ 已跳过</span>' : ''}
      ${isMissing ? '<span class="runner-status-chip missing">⚠️ 条目缺失</span>' : ''}
      ${currentStepIndex > 0 ? '<span class="runner-hint">提示：可随时点击「结束路线」提前完成并保存记录</span>' : ''}
    </div>
  `;

  nextBtn.style.display = 'inline-flex';
  skipBtn.style.display = 'inline-flex';
  endBtn.textContent = '结束路线';
  endBtn.classList.remove('btn-success');
  endBtn.classList.add('btn-outline');

  if (isMissing) {
    nextBtn.style.display = 'none';
    skipBtn.textContent = '跳过缺失条目 →';
  } else if (isPracticed) {
    nextBtn.textContent = '下一条 →';
    skipBtn.textContent = '跳过';
  } else {
    nextBtn.textContent = '记录试讲并下一条 →';
    skipBtn.textContent = '跳过';
  }
}

function advanceToNextUnhandled(refs: ReturnType<typeof getRouteCards>, practiced: Set<string>, skipped: Set<string>): void {
  while (currentStepIndex < refs.length) {
    const ref = refs[currentStepIndex];
    if (ref.missing) {
      currentStepIndex++;
      continue;
    }
    if (!practiced.has(ref.cardId) && !skipped.has(ref.cardId)) {
      break;
    }
    currentStepIndex++;
  }
}

function handleNextStep(): void {
  const route = getActiveRoute();
  if (!activeRun || !route) return;
  const refs = getRouteCards(route, cards);
  if (currentStepIndex >= refs.length) return;
  const ref = refs[currentStepIndex];

  if (ref.missing) {
    currentStepIndex++;
  } else {
    const card = cards.find((c) => c.id === ref.cardId);
    if (card) recordCardPractice(card);
    activeRun.practicedCardIds = Array.from(new Set([...activeRun.practicedCardIds, ref.cardId]));
    activeRun.skippedCardIds = activeRun.skippedCardIds.filter((id) => id !== ref.cardId);
    currentStepIndex++;
  }

  const practiced = new Set(activeRun.practicedCardIds);
  const skipped = new Set(activeRun.skippedCardIds);
  advanceToNextUnhandled(refs, practiced, skipped);

  persist();
  render();
  renderRouteRunner();
}

function handleSkipStep(): void {
  const route = getActiveRoute();
  if (!activeRun || !route) return;
  const refs = getRouteCards(route, cards);
  if (currentStepIndex >= refs.length) return;
  const ref = refs[currentStepIndex];

  activeRun.skippedCardIds = Array.from(new Set([...activeRun.skippedCardIds, ref.cardId]));
  activeRun.practicedCardIds = activeRun.practicedCardIds.filter((id) => id !== ref.cardId);
  currentStepIndex++;

  const practiced = new Set(activeRun.practicedCardIds);
  const skipped = new Set(activeRun.skippedCardIds);
  advanceToNextUnhandled(refs, practiced, skipped);

  persist();
  render();
  renderRouteRunner();
}

function endRouteRun(): void {
  const route = getActiveRoute();
  if (!activeRun || !route) return;
  const noteEl = document.getElementById('rr-note') as HTMLTextAreaElement | null;
  const note = noteEl ? noteEl.value.trim() : '';
  activeRun.finishedAt = Date.now();
  activeRun.note = note;
  routeRuns.push(activeRun);

  const idx = routes.findIndex((r) => r.id === route.id);
  if (idx >= 0) {
    routes[idx].lastRunAt = activeRun.finishedAt;
    routes[idx].updatedAt = activeRun.finishedAt;
  }

  persist();
  const practicedCount = activeRun.practicedCardIds.length;
  const skippedCount = activeRun.skippedCardIds.length;
  closeModal('route-runner-modal');
  activeRun = null;
  activeRunRouteId = null;
  currentStepIndex = 0;
  render();
  toast(`路线执行已记录：已练 ${practicedCount} 个，跳过 ${skippedCount} 个`, 'success');
}

function showRouteDetail(route: TrainingRoute): void {
  const summary = calculateRouteSummary(route, cards, routeRuns);
  const refs = getRouteCards(route, cards);
  const routeRunsForRoute = routeRuns
    .filter((r) => r.routeId === route.id)
    .sort((a, b) => b.startedAt - a.startedAt);

  document.getElementById('route-detail-title')!.textContent = route.name || '(未命名路线)';
  const content = document.getElementById('route-detail-content')!;

  const avgMin = summary.averageDurationMs > 0 ? Math.round(summary.averageDurationMs / 60000) : 0;

  content.innerHTML = `
    ${route.description ? `<p style="color:var(--text-muted);font-size:13px;margin-top:0">${escapeHtml(route.description)}</p>` : ''}
    <div class="route-detail-section">
      <h4>基本信息</h4>
      <div class="route-detail-meta">
        <div><strong>目标日期</strong>${formatDate(route.targetDate)}</div>
        <div><strong>创建时间</strong>${formatDateTime(route.createdAt)}</div>
        <div><strong>最近修改</strong>${formatDateTime(route.updatedAt)}</div>
        <div><strong>步骤数</strong>${summary.totalSteps}（有效 ${summary.validSteps}）</div>
        <div><strong>预计时长</strong>${formatDuration(summary.totalDurationMinutes)}</div>
        <div><strong>执行次数</strong>${summary.runCount}</div>
        ${avgMin > 0 ? `<div><strong>平均耗时</strong>${avgMin} 分钟</div>` : ''}
        ${summary.lastRunAt ? `<div><strong>最近执行</strong>${formatDateTime(summary.lastRunAt)}</div>` : ''}
        ${route.archivedAt ? `<div><strong>归档时间</strong>${formatDateTime(route.archivedAt)}</div>` : ''}
      </div>
    </div>

    <div class="route-detail-section">
      <h4>步骤列表（${refs.length}）</h4>
      <div class="route-steps-preview">
        ${refs.map((ref, idx) => `
          <div class="route-step-preview-item ${ref.missing ? 'missing' : ''}">
            <span class="route-step-idx">${idx + 1}</span>
            <span class="route-step-name">${ref.missing ? `⚠️ 缺失条目（${ref.cardId.slice(0, 10)}）` : escapeHtml(ref.card!.title) + ` <small style="color:var(--text-muted)">${escapeHtml(ref.card!.zone || '')} · ${ref.card!.durationMinutes}分钟</small>`}</span>
          </div>
        `).join('')}
      </div>
    </div>

    ${summary.goalSummaries.length > 0 ? `
      <div class="route-detail-section">
        <h4>阶段目标摘要（已达成 ${summary.achievedGoalCount} / ${summary.goalSummaries.length}）</h4>
        <div class="route-steps-preview">
          ${summary.goalSummaries.map((g) => `
            <div class="route-step-preview-item" style="background:${g.status === 'achieved' ? 'var(--success-bg)' : 'var(--bg)'}">
              <span class="route-step-idx" style="background:${GOAL_STATUS_COLORS[g.status]};color:#fff">${g.status === 'achieved' ? '✓' : '○'}</span>
              <span class="route-step-name">${escapeHtml(g.cardTitle)} <small>${GOAL_STATUS_LABELS[g.status]} · ${Math.round(g.overallProgress * 100)}% · 截止 ${formatDate(g.dueDate)}</small></span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="route-detail-section">
      <h4>执行记录（${routeRunsForRoute.length}）</h4>
      ${routeRunsForRoute.length === 0 ? '<p style="color:var(--text-muted);font-size:12px">暂无执行记录</p>' :
        routeRunsForRoute.map((run) => {
          const durMin = run.finishedAt ? Math.round((run.finishedAt - run.startedAt) / 60000) : 0;
          return `
            <div class="run-history-item">
              <div class="run-head">
                <span>${formatDateTime(run.startedAt)}</span>
                <span>${run.finishedAt ? `耗时 ${durMin} 分钟` : '进行中'}</span>
              </div>
              <div>已练 ${run.practicedCardIds.length} 个 · 跳过 ${run.skippedCardIds.length} 个</div>
              ${run.note ? `<div class="run-note">📝 ${escapeHtml(run.note)}</div>` : ''}
            </div>
          `;
        }).join('')
      }
    </div>
  `;
  openModal('route-detail-modal');
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
    if (cards.length === 0 && routes.length === 0) { toast('暂无内容可导出', 'warning'); return; }
    const content = exportToJson(cards, routes, routeRuns);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.json`, 'application/json');
    toast(`已导出 ${cards.length} 个条目、${routes.length} 条路线为 JSON`, 'success');
  });

  document.getElementById('btn-export-md')!.addEventListener('click', () => {
    if (cards.length === 0 && routes.length === 0) { toast('暂无内容可导出', 'warning'); return; }
    const content = exportToMarkdown(cards, routes, routeRuns);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.md`, 'text/markdown');
    toast(`已导出 ${cards.length} 个条目、${routes.length} 条路线为 Markdown`, 'success');
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = (tab as HTMLElement).dataset.view as 'cards' | 'routes';
      switchView(view);
    });
  });

  document.getElementById('btn-add-route')!.addEventListener('click', () => openRouteEditor(null));
  document.getElementById('btn-save-route')!.addEventListener('click', saveRouteFromForm);
  document.getElementById('btn-recommend-route')!.addEventListener('click', generateTodayRoute);
  document.getElementById('btn-quick-route')!.addEventListener('click', quickCreateZoneRoute);

  document.querySelectorAll<HTMLInputElement>('input[name="rf-picker-source"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      pickerSource = (e.target as HTMLInputElement).value as 'filtered' | 'all';
      renderRoutePicker();
    });
  });
  (document.getElementById('rf-picker-search') as HTMLInputElement).addEventListener('input', (e) => {
    pickerSearch = (e.target as HTMLInputElement).value.trim();
    renderRoutePicker();
  });

  (document.getElementById('route-sort-by') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortBy = (e.target as HTMLSelectElement).value as RouteSortKey;
    renderRoutes();
  });
  (document.getElementById('route-sort-order') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortOrder = (e.target as HTMLSelectElement).value as 'asc' | 'desc';
    renderRoutes();
  });

  document.getElementById('btn-next-route-step')!.addEventListener('click', handleNextStep);
  document.getElementById('btn-skip-route-step')!.addEventListener('click', handleSkipStep);
  document.getElementById('btn-end-route-run')!.addEventListener('click', () => {
    if (!activeRun) return;
    endRouteRun();
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
        ['card-modal', 'daily-modal', 'check-modal', 'confirm-modal', 'route-editor-modal', 'route-runner-modal', 'route-detail-modal'].forEach((id) => {
          const m = document.getElementById(id);
          if (m && m.style.display === 'flex') closeModal(id);
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
