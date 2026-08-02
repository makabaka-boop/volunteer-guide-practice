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
  createEmptyRoute,
  cloneRoute,
  loadRoutes,
  saveRoutes,
  loadRouteRuns,
  saveRouteRuns,
  generateId
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
  sortRoutes,
  generateRecommendedRoute
} from './utils';

let cards: PracticeCard[] = [];
let selectedIds: Set<string> = new Set();
let editingCard: PracticeCard | null = null;
let sortBy: string = 'updated';
let sortOrder: 'asc' | 'desc' = 'desc';

let routes: TrainingRoute[] = [];
let routeRuns: RouteRunRecord[] = [];
let editingRoute: TrainingRoute | null = null;
let activeTab: 'cards' | 'routes' = 'cards';
let routeSortBy: RouteSortBy = 'targetDate';
let routeSortOrder: 'asc' | 'desc' = 'asc';
let showArchivedRoutes = false;

let activeRun: {
  route: TrainingRoute;
  runRecord: RouteRunRecord;
  currentIndex: number;
  allStepIds: string[];
} | null = null;

let routeEditorSource: 'all' | 'filtered' = 'all';

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

function switchTab(tab: 'cards' | 'routes'): void {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  document.getElementById('tab-cards')!.style.display = tab === 'cards' ? 'contents' : 'none';
  document.getElementById('tab-routes')!.style.display = tab === 'routes' ? 'contents' : 'none';
  if (tab === 'routes') renderRoutes();
}

function render(): void {
  renderZoneChips();
  renderStats();
  renderCards();
  renderBatchPanel();
  if (activeTab === 'routes') renderRoutes();
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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getFilteredRoutes(): TrainingRoute[] {
  let filtered = routes;
  if (!showArchivedRoutes) {
    filtered = filtered.filter((r) => !r.archivedAt);
  }
  return sortRoutes(filtered, routeSortBy, routeSortOrder);
}

function renderRoutes(): void {
  const list = getFilteredRoutes();
  const container = document.getElementById('routes-container')!;
  const empty = document.getElementById('routes-empty')!;
  const info = document.getElementById('routes-info')!;

  const activeCount = routes.filter((r) => !r.archivedAt).length;
  const archivedCount = routes.filter((r) => r.archivedAt).length;
  const totalDuration = list.reduce((sum, r) => {
    const steps = getRouteCards(r, cards);
    return sum + steps.filter((s) => !s.isMissing).reduce((s, c) => s + (c.card?.durationMinutes || 0), 0);
  }, 0);

  info.innerHTML = `共 <strong>${activeCount}</strong> 条活跃路线${archivedCount > 0 ? `，<strong>${archivedCount}</strong> 条已归档` : ''}，预计总时长 <strong>${formatDuration(totalDuration)}</strong>`;

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  container.innerHTML = list.map(renderRouteCardHtml).join('');

  container.querySelectorAll('.route-card').forEach((el) => {
    const routeEl = el as HTMLElement;
    const id = routeEl.getAttribute('data-id')!;
    const route = routes.find((r) => r.id === id);
    if (!route) return;

    routeEl.querySelector('[data-action="route-run"]')?.addEventListener('click', () => {
      startRouteRun(route);
    });
    routeEl.querySelector('[data-action="route-edit"]')?.addEventListener('click', () => {
      openRouteEditor(route);
    });
    routeEl.querySelector('[data-action="route-detail"]')?.addEventListener('click', () => {
      showRouteDetail(route);
    });
    routeEl.querySelector('[data-action="route-clone"]')?.addEventListener('click', () => {
      const newRoute = cloneRoute(route);
      routes.push(newRoute);
      persist();
      renderRoutes();
      toast(`已复制路线「${route.name}」`, 'success');
    });
    routeEl.querySelector('[data-action="route-archive"]')?.addEventListener('click', () => {
      if (route.archivedAt) {
        route.archivedAt = undefined;
        toast('已取消归档', 'info');
      } else {
        route.archivedAt = Date.now();
        toast('已归档路线', 'info');
      }
      route.updatedAt = Date.now();
      persist();
      renderRoutes();
    });
    routeEl.querySelector('[data-action="route-delete"]')?.addEventListener('click', () => {
      showConfirm('删除路线', `确认删除路线「${route.name}」？关联的执行记录也将被删除，此操作不可恢复。`, () => {
        routes = routes.filter((r) => r.id !== id);
        routeRuns = routeRuns.filter((r) => r.routeId !== id);
        persist();
        renderRoutes();
        toast('已删除路线', 'success');
      });
    });
    routeEl.querySelector('[data-action="clean-invalid"]')?.addEventListener('click', () => {
      const steps = getRouteCards(route, cards);
      const invalidCount = steps.filter((s) => s.isMissing).length;
      const validIds = steps.filter((s) => !s.isMissing).map((s) => s.cardId);
      route.stepIds = validIds;
      route.updatedAt = Date.now();
      persist();
      renderRoutes();
      toast(`已清理 ${invalidCount} 个无效步骤`, 'success');
    });
  });
}

function renderRouteCardHtml(route: TrainingRoute): string {
  const steps = getRouteCards(route, cards);
  const summary = calculateRouteSummary(route, cards, routeRuns);
  const missingSteps = steps.filter((s) => s.isMissing);
  const now = Date.now();
  const DAY = 86400000;
  const daysToTarget = Math.ceil((route.targetDate - now) / DAY);
  let targetClass = '';
  let targetText = formatDate(route.targetDate);
  if (!route.archivedAt) {
    if (daysToTarget < 0) { targetClass = 'overdue'; targetText = `已逾期 ${Math.abs(daysToTarget)} 天`; }
    else if (daysToTarget <= 3) { targetClass = 'near-due'; targetText = `${daysToTarget === 0 ? '今天' : daysToTarget + ' 天后'}截止`; }
  }

  const goalBadges: string[] = [];
  if (summary.goalAchievedCount > 0) goalBadges.push(`<span class="route-goal-badge achieved">🎯 ${summary.goalAchievedCount} 已达成</span>`);
  if (summary.goalInProgressCount > 0) goalBadges.push(`<span class="route-goal-badge in-progress">📈 ${summary.goalInProgressCount} 进行中</span>`);
  if (summary.goalNearDueCount > 0) goalBadges.push(`<span class="route-goal-badge near-due">⚡ ${summary.goalNearDueCount} 临期</span>`);
  if (summary.goalOverdueCount > 0) goalBadges.push(`<span class="route-goal-badge overdue">⚠️ ${summary.goalOverdueCount} 逾期</span>`);
  if (summary.unreviewedCount > 0) goalBadges.push(`<span class="route-goal-badge unreviewed">📝 ${summary.unreviewedCount} 待复盘</span>`);
  if (summary.missingSteps > 0) goalBadges.push(`<span class="route-goal-badge missing">❓ ${summary.missingSteps} 缺失</span>`);

  return `
    <div class="route-card ${route.archivedAt ? 'archived' : ''} ${missingSteps.length > 0 ? 'has-missing' : ''}" data-id="${route.id}">
      <div class="route-card-header">
        <h3 class="route-card-title">
          ${escapeHtml(route.name || '(未命名路线)')}
          ${route.archivedAt ? '<span style="font-size:11px;color:var(--text-muted);font-weight:400;">已归档</span>' : ''}
        </h3>
        ${route.description ? `<p class="route-card-desc">${escapeHtml(route.description)}</p>` : ''}
        <div class="route-card-meta">
          <span class="meta-item ${targetClass}">📅 ${targetText}</span>
          <span class="meta-item">📝 ${formatDate(route.updatedAt)}</span>
          ${route.lastRunAt ? `<span class="meta-item">▶️ ${formatDateTime(route.lastRunAt)}</span>` : ''}
        </div>
      </div>
      <div class="route-card-stats">
        <div class="route-stat"><div class="route-stat-value">${summary.validSteps}</div><div class="route-stat-label">有效步骤</div></div>
        <div class="route-stat"><div class="route-stat-value" style="font-size:14px;">${formatDuration(summary.totalDurationMinutes)}</div><div class="route-stat-label">预计时长</div></div>
        <div class="route-stat"><div class="route-stat-value">${summary.totalRuns}</div><div class="route-stat-label">执行次数</div></div>
        <div class="route-stat"><div class="route-stat-value" style="color:${summary.unreviewedCount > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${summary.unreviewedCount}</div><div class="route-stat-label">待复盘</div></div>
      </div>
      ${goalBadges.length > 0 ? `<div class="route-card-goals">${goalBadges.join('')}</div>` : ''}
      ${missingSteps.length > 0 ? `
        <div class="route-missing-warning">
          <span>⚠️ ${missingSteps.length} 个条目已缺失（可能被删除）</span>
          <button data-action="clean-invalid">一键清理</button>
        </div>
      ` : ''}
      <div class="route-card-actions">
        <button data-action="route-run" class="success" title="开始执行">▶️ 执行</button>
        <button data-action="route-detail" title="查看详情">👁️ 详情</button>
        <button data-action="route-edit" title="编辑">✏️ 编辑</button>
        <button data-action="route-clone" title="复制">📋 复制</button>
        <button data-action="route-archive" title="归档/取消归档">${route.archivedAt ? '📤 取消归档' : '📥 归档'}</button>
        <button data-action="route-delete" class="danger" title="删除">🗑️ 删除</button>
      </div>
    </div>
  `;
}

function openRouteEditor(route: TrainingRoute | null, titleOverride?: string): void {
  editingRoute = route ? { ...route, stepIds: [...route.stepIds] } : createEmptyRoute();
  routeEditorSource = 'all';
  const isExisting = route ? routes.some((r) => r.id === route.id) : false;
  let title: string;
  if (titleOverride) {
    title = titleOverride;
  } else if (route && isExisting) {
    title = '编辑训练路线';
  } else if (route && route.name.startsWith('今日重点路线')) {
    title = '预览今日重点路线';
  } else {
    title = '新建训练路线';
  }
  document.getElementById('route-modal-title')!.textContent = title;

  (document.getElementById('rf-name') as HTMLInputElement).value = editingRoute.name;
  (document.getElementById('rf-description') as HTMLTextAreaElement).value = editingRoute.description;
  const targetDate = new Date(editingRoute.targetDate);
  (document.getElementById('rf-target-date') as HTMLInputElement).value = targetDate.toISOString().split('T')[0];

  const allRadio = document.querySelector('input[name="rf-source"][value="all"]') as HTMLInputElement;
  if (allRadio) allRadio.checked = true;

  renderRouteEditor();
  openModal('route-modal');
}

function getQuickZoneOrder(): string[] {
  const canonicalOrder = ['序厅', '历史展区', '主展区', '互动区', '尾厅'];
  const existingZones = new Set(cards.map((c) => c.zone).filter(Boolean));
  const ordered = canonicalOrder.filter((z) => existingZones.has(z));
  const extra = getUniqueZones(cards).filter((z) => !canonicalOrder.includes(z));
  return [...ordered, ...extra];
}

function quickAddByZones(): void {
  if (!editingRoute) return;
  const zoneOrder = getQuickZoneOrder();
  const orderedIds: string[] = [];
  const existingSet = new Set(editingRoute.stepIds);
  for (const zone of zoneOrder) {
    const zoneCards = cards.filter((c) => c.zone === zone && c.title);
    for (const c of zoneCards) {
      if (!existingSet.has(c.id)) {
        orderedIds.push(c.id);
        existingSet.add(c.id);
      }
    }
  }
  const added = orderedIds.length;
  editingRoute.stepIds = [...editingRoute.stepIds, ...orderedIds];
  renderRouteEditor();
  if (added > 0) {
    toast(`已按展区顺序添加 ${added} 个条目`, 'success');
  } else {
    toast('所有条目已在路线中', 'info');
  }
}

function openRecommendedRoute(): void {
  if (cards.filter((c) => c.title).length === 0) {
    toast('请先创建讲解条目', 'warning');
    return;
  }

  const draft = generateRecommendedRoute(cards, routes, routeRuns);

  if (draft.stepIds.length === 0) {
    toast('当前没有需要重点练习的条目，将打开空路线编辑器', 'info');
  } else {
    toast(`已生成推荐路线，包含 ${draft.stepIds.length} 个条目，可调整后保存`, 'success');
  }

  openRouteEditor(draft);
}

function renderRouteEditor(): void {
  if (!editingRoute) return;
  const availableContainer = document.getElementById('rf-available-cards')!;
  const selectedContainer = document.getElementById('rf-selected-steps')!;
  const stepCountEl = document.getElementById('rf-step-count')!;
  const availableCountEl = document.getElementById('rf-available-count')!;

  const selectedSet = new Set(editingRoute.stepIds);
  const sourceCards = routeEditorSource === 'filtered' ? getFilteredSortedCards() : cards;
  const availableCards = sourceCards.filter((c) => c.title);

  stepCountEl.textContent = String(editingRoute.stepIds.length);
  availableCountEl.textContent = `（${availableCards.length} 个可选）`;

  const totalDuration = editingRoute.stepIds.reduce((sum, id) => {
    const c = cards.find((card) => card.id === id);
    return sum + (c ? c.durationMinutes : 0);
  }, 0);
  const stepCountParent = stepCountEl.parentElement;
  if (stepCountParent) {
    stepCountParent.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">共 <strong id="rf-step-count">${editingRoute.stepIds.length}</strong> 个步骤 · 预计 <strong>${formatDuration(totalDuration)}</strong></span>`;
  }

  availableContainer.innerHTML = availableCards.length === 0
    ? '<span class="empty-hint">当前来源没有可选条目</span>'
    : availableCards.map((c) => {
        const isSelected = selectedSet.has(c.id);
        const famColor = FAMILIARITY_COLORS[c.familiarity];
        return `<span class="route-picker-item ${isSelected ? 'selected' : ''}" data-card-id="${c.id}">
          ${escapeHtml(c.title)}
          <span class="picker-zone">${escapeHtml(c.zone || '')}</span>
          <span class="picker-fam" style="background:${famColor}">${FAMILIARITY_LABELS[c.familiarity]}</span>
        </span>`;
      }).join('');

  availableContainer.querySelectorAll('.route-picker-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (!editingRoute) return;
      const cardId = (el as HTMLElement).dataset.cardId!;
      if (editingRoute.stepIds.includes(cardId)) {
        editingRoute.stepIds = editingRoute.stepIds.filter((id) => id !== cardId);
      } else {
        editingRoute.stepIds.push(cardId);
      }
      renderRouteEditor();
    });
  });

  if (editingRoute.stepIds.length === 0) {
    selectedContainer.innerHTML = '<div class="route-empty-hint">从上方点击条目添加到路线，或使用"按展区快速编组"</div>';
    return;
  }

  const cardMap = new Map<string, PracticeCard>();
  cards.forEach((c) => cardMap.set(c.id, c));

  selectedContainer.innerHTML = editingRoute.stepIds.map((cardId, idx) => {
    const card = cardMap.get(cardId);
    const isMissing = !card;
    let goalBadge = '';
    if (card && card.stageGoal) {
      const status = getGoalStatus(card);
      const statusInfo: Record<string, { icon: string; cls: string; label: string }> = {
        achieved: { icon: '🎯', cls: 'achieved', label: '已达成' },
        in_progress: { icon: '📈', cls: 'in-progress', label: '进行中' },
        near_due: { icon: '⚡', cls: 'near-due', label: '临期' },
        overdue: { icon: '⚠️', cls: 'overdue', label: '逾期' },
        none: { icon: '', cls: '', label: '' }
      };
      const info = statusInfo[status];
      if (info && info.icon) {
        goalBadge = `<span class="step-goal-badge ${info.cls}" title="目标${info.label}">${info.icon}</span>`;
      }
    }
    const reviewBadge = card && !card.isReviewed && card.practiceCount > 0
      ? '<span class="step-review-badge" title="待复盘">📝</span>'
      : '';
    return `
      <div class="route-step-item ${isMissing ? 'missing' : ''}" data-card-id="${cardId}" data-idx="${idx}">
        <div class="route-step-number">${idx + 1}</div>
        <div class="route-step-info">
          <div class="route-step-title">
            ${isMissing ? `<span style="color:var(--warning)">⚠️ 缺失条目</span>` : escapeHtml(card!.title)}
            ${goalBadge}${reviewBadge}
          </div>
          ${card ? `<div class="route-step-meta">
            <span>📍 ${escapeHtml(card.zone || '未设展区')}</span>
            <span>⏱️ ${card.durationMinutes}分钟</span>
            <span class="fam-tag fam-${card.familiarity}" style="background:${FAMILIARITY_COLORS[card.familiarity]}">${FAMILIARITY_LABELS[card.familiarity]}</span>
          </div>` : ''}
        </div>
        <div class="route-step-move">
          <button data-move="up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button data-move="down" ${idx === editingRoute!.stepIds.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <button class="route-step-remove" data-remove title="移除">×</button>
      </div>
    `;
  }).join('');

  selectedContainer.querySelectorAll('.route-step-item').forEach((el) => {
    const item = el as HTMLElement;
    const idx = parseInt(item.dataset.idx || '0', 10);

    item.querySelector('[data-move="up"]')?.addEventListener('click', () => {
      if (idx > 0 && editingRoute) {
        const ids = editingRoute.stepIds;
        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
        renderRouteEditor();
      }
    });
    item.querySelector('[data-move="down"]')?.addEventListener('click', () => {
      if (editingRoute && idx < editingRoute.stepIds.length - 1) {
        const ids = editingRoute.stepIds;
        [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
        renderRouteEditor();
      }
    });
    item.querySelector('[data-remove]')?.addEventListener('click', () => {
      if (editingRoute) {
        editingRoute.stepIds.splice(idx, 1);
        renderRouteEditor();
      }
    });
  });
}

function saveRouteFromForm(): boolean {
  if (!editingRoute) return false;

  const name = (document.getElementById('rf-name') as HTMLInputElement).value.trim();
  if (!name) { toast('请填写路线名称', 'error'); return false; }

  const description = (document.getElementById('rf-description') as HTMLTextAreaElement).value.trim();
  const targetDateStr = (document.getElementById('rf-target-date') as HTMLInputElement).value;
  const targetDate = targetDateStr ? new Date(targetDateStr).getTime() : Date.now() + 14 * 86400000;

  const now = Date.now();
  const isNew = !routes.some((r) => r.id === editingRoute!.id);

  editingRoute.name = name;
  editingRoute.description = description;
  editingRoute.targetDate = targetDate;
  editingRoute.updatedAt = now;

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
  return true;
}

function showRouteDetail(route: TrainingRoute): void {
  const steps = getRouteCards(route, cards);
  const summary = calculateRouteSummary(route, cards, routeRuns);
  const routeRunsForRoute = routeRuns
    .filter((r) => r.routeId === route.id && r.finishedAt)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

  const content = document.getElementById('route-detail-content')!;
  document.getElementById('route-detail-title')!.textContent = route.name || '(未命名路线)';

  const hasGoalData = summary.goalAchievedCount + summary.goalInProgressCount + summary.goalNearDueCount + summary.goalOverdueCount + summary.unreviewedCount + summary.missingSteps > 0;
  const goalSection = hasGoalData
    ? `
      <div class="route-detail-section">
        <h3>🎯 阶段目标与复盘摘要</h3>
        <div class="route-card-goals" style="padding:0;">
          ${summary.goalAchievedCount > 0 ? `<span class="route-goal-badge achieved">🎯 已达成 ${summary.goalAchievedCount}</span>` : ''}
          ${summary.goalInProgressCount > 0 ? `<span class="route-goal-badge in-progress">📈 进行中 ${summary.goalInProgressCount}</span>` : ''}
          ${summary.goalNearDueCount > 0 ? `<span class="route-goal-badge near-due">⚡ 临期 ${summary.goalNearDueCount}</span>` : ''}
          ${summary.goalOverdueCount > 0 ? `<span class="route-goal-badge overdue">⚠️ 逾期 ${summary.goalOverdueCount}</span>` : ''}
          ${summary.unreviewedCount > 0 ? `<span class="route-goal-badge unreviewed">📝 待复盘 ${summary.unreviewedCount}</span>` : ''}
          ${summary.missingSteps > 0 ? `<span class="route-goal-badge missing">❓ 缺失 ${summary.missingSteps}</span>` : ''}
        </div>
      </div>`
    : '';

  content.innerHTML = `
    <div class="route-detail-section">
      ${route.description ? `<p style="color:var(--text-muted);margin:0 0 12px;">${escapeHtml(route.description)}</p>` : ''}
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-muted);">
        <span>📅 目标日期：${formatDate(route.targetDate)}</span>
        <span>📝 创建：${formatDate(route.createdAt)}</span>
        <span>🔄 修改：${formatDate(route.updatedAt)}</span>
        ${route.lastRunAt ? `<span>▶️ 最近执行：${formatDateTime(route.lastRunAt)}</span>` : ''}
      </div>
    </div>
    <div class="route-detail-section">
      <h3>📊 路线统计</h3>
      <div class="route-card-stats" style="border-radius:var(--radius-sm);overflow:hidden;">
        <div class="route-stat"><div class="route-stat-value">${summary.totalSteps}</div><div class="route-stat-label">总步骤</div></div>
        <div class="route-stat"><div class="route-stat-value" style="color:var(--success)">${summary.validSteps}</div><div class="route-stat-label">有效</div></div>
        <div class="route-stat"><div class="route-stat-value" style="color:${summary.missingSteps > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${summary.missingSteps}</div><div class="route-stat-label">缺失</div></div>
        <div class="route-stat"><div class="route-stat-value">${formatDuration(summary.totalDurationMinutes)}</div><div class="route-stat-label">时长</div></div>
      </div>
    </div>
    ${goalSection}
    <div class="route-detail-section">
      <h3>📋 路线步骤 (${steps.length})</h3>
      <div class="route-detail-steps">
        ${steps.map((step, idx) => `
          <div class="route-detail-step ${step.isMissing ? 'missing' : ''}">
            <div class="step-num">${idx + 1}</div>
            <div class="step-info">
              ${step.isMissing
                ? `<div class="step-title" style="color:var(--warning)">⚠️ 缺失条目（ID: ${escapeHtml(step.cardId)}）</div>`
                : `<div class="step-title">${escapeHtml(step.card!.title)}</div>
                   <div class="step-meta">📍 ${escapeHtml(step.card!.zone || '未设展区')} · ⏱️ ${step.card!.durationMinutes}分钟 · ${FAMILIARITY_LABELS[step.card!.familiarity]}</div>`
              }
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ${routeRunsForRoute.length > 0 ? `
      <div class="route-detail-section">
        <h3>📜 执行记录 (${routeRunsForRoute.length})</h3>
        ${routeRunsForRoute.map((run, idx) => {
          const duration = run.finishedAt ? Math.round((run.finishedAt - run.startedAt) / 60000) : 0;
          return `
            <div class="route-history-item">
              <div class="history-date">第 ${routeRunsForRoute.length - idx} 次 · ${formatDateTime(run.finishedAt)}</div>
              <div class="history-stats">
                ✅ 已练习 ${run.practicedCardIds.length} · ⏭️ 已跳过 ${run.skippedCardIds.length} · ⏱️ 约 ${duration} 分钟
                ${run.note ? ` · 📝 ${escapeHtml(run.note)}` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}
  `;

  const runBtn = document.getElementById('btn-detail-run')!;
  runBtn.onclick = () => {
    closeModal('route-detail-modal');
    startRouteRun(route);
  };

  openModal('route-detail-modal');
}

function startRouteRun(route: TrainingRoute): void {
  if (route.stepIds.length === 0) {
    toast('该路线没有步骤，无法执行', 'warning');
    return;
  }

  const runRecord: RouteRunRecord = {
    id: generateId(),
    routeId: route.id,
    startedAt: Date.now(),
    practicedCardIds: [],
    skippedCardIds: [],
    note: ''
  };

  activeRun = {
    route,
    runRecord,
    currentIndex: 0,
    allStepIds: [...route.stepIds]
  };

  (document.getElementById('route-run-note') as HTMLTextAreaElement).value = '';
  document.getElementById('route-run-title')!.textContent = `执行：${route.name || '(未命名路线)'}`;

  renderRunModal();
  openModal('route-run-modal');
}

function renderRunModal(): void {
  if (!activeRun) return;

  const progressEl = document.getElementById('route-run-progress')!;
  const currentEl = document.getElementById('route-run-current')!;
  const upcomingEl = document.getElementById('route-run-upcoming')!;
  const practiceBtn = document.getElementById('btn-run-practice') as HTMLButtonElement;
  const skipBtn = document.getElementById('btn-run-skip') as HTMLButtonElement;
  const finishEarlyBtn = document.getElementById('btn-run-finish-early') as HTMLButtonElement;
  const finishBtn = document.getElementById('btn-run-finish') as HTMLButtonElement;

  const total = activeRun.allStepIds.length;
  const practiced = activeRun.runRecord.practicedCardIds.length;
  const skipped = activeRun.runRecord.skippedCardIds.length;
  const completed = practiced + skipped;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const cardMap = new Map<string, PracticeCard>();
  cards.forEach((c) => cardMap.set(c.id, c));

  const totalDuration = activeRun.allStepIds.reduce((sum, id) => {
    const c = cardMap.get(id);
    return sum + (c ? c.durationMinutes : 0);
  }, 0);
  const practicedDuration = activeRun.allStepIds
    .slice(0, activeRun.currentIndex)
    .reduce((sum, id) => {
      const c = cardMap.get(id);
      return sum + (c ? c.durationMinutes : 0);
    }, 0);

  const elapsedMs = Date.now() - activeRun.runRecord.startedAt;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const elapsedStr = `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}`;

  progressEl.innerHTML = `
    <div class="run-header-info">
      <div class="run-header-title">${escapeHtml(activeRun.route.name || '(未命名路线)')}</div>
      <div class="run-header-stats">
        <span class="run-header-stat">📊 步骤 ${completed}/${total}</span>
        <span class="run-header-stat">⏱️ 总时长 ${formatDuration(totalDuration)}</span>
        <span class="run-header-stat">⏳ 已用 ${elapsedStr}</span>
        <span class="run-header-stat" style="color:var(--success)">✅ ${practiced}</span>
        <span class="run-header-stat" style="color:var(--text-muted)">⏭️ ${skipped}</span>
      </div>
    </div>
    <div class="route-run-progress-bar">
      <div class="route-run-progress-fill" style="width:${progressPercent}%"></div>
    </div>
    <div class="route-run-progress-text">
      <span>进度：${completed} / ${total}（已练习 ${practiced}，跳过 ${skipped}）</span>
      <span>${progressPercent}%</span>
    </div>
  `;

  if (activeRun.currentIndex >= total) {
    currentEl.innerHTML = `
      <div class="route-run-complete">
        <div class="route-run-complete-icon">🎉</div>
        <div class="route-run-complete-title">路线执行完毕！</div>
        <div class="route-run-complete-desc">
          已练习 ${practiced} 个步骤，跳过 ${skipped} 个步骤<br/>
          共试讲 ${formatDuration(practicedDuration)}，用时 ${elapsedStr}
        </div>
      </div>
    `;
    upcomingEl.innerHTML = '';
    practiceBtn.style.display = 'none';
    skipBtn.style.display = 'none';
    finishEarlyBtn.style.display = 'none';
    finishBtn.style.display = '';
    return;
  }

  practiceBtn.style.display = '';
  skipBtn.style.display = '';
  finishEarlyBtn.style.display = '';
  finishBtn.style.display = 'none';

  const currentCardId = activeRun.allStepIds[activeRun.currentIndex];
  const currentCard = cardMap.get(currentCardId);
  const isMissing = !currentCard;

  if (isMissing) {
    currentEl.innerHTML = `
      <div class="route-run-current-label">步骤 ${activeRun.currentIndex + 1} / ${total}</div>
      <div class="route-run-missing">
        <div class="route-run-missing-icon">❓</div>
        <div class="route-run-missing-title">条目已不存在</div>
        <div class="route-run-missing-desc">
          该步骤引用的讲解条目可能已被删除（ID: ${escapeHtml(currentCardId)}）。<br/>
          请点击"跳过"继续下一个步骤。
        </div>
      </div>
    `;
    practiceBtn.disabled = true;
    practiceBtn.style.opacity = '0.5';
    practiceBtn.style.cursor = 'not-allowed';
  } else if (currentCard) {
    practiceBtn.disabled = false;
    practiceBtn.style.opacity = '';
    practiceBtn.style.cursor = '';

    const goalProgress = calculateGoalProgress(currentCard);
    const goalStatus = goalProgress ? goalProgress.status : 'none';
    const goalColor = GOAL_STATUS_COLORS[goalStatus];

    let goalSection = '';
    if (currentCard.stageGoal && goalProgress) {
      const progressPercent = Math.round(goalProgress.overallProgress * 100);
      const daysText = formatDaysRemaining(goalProgress.daysRemaining);
      const isCompleted = !!currentCard.stageGoal.completedAt;
      goalSection = `
        <div class="run-goal-section">
          <div class="run-goal-header">
            <span>🎯 阶段目标</span>
            <span class="goal-status-badge" style="background:${goalColor}">${GOAL_STATUS_LABELS[goalStatus]}</span>
          </div>
          <div class="goal-progress-bar">
            <div class="goal-progress-fill" style="width:${progressPercent}%;background:${goalColor}"></div>
          </div>
          <div class="run-goal-meta">
            <span>${progressPercent}%</span>
            <span style="color:${goalColor}">${daysText}</span>
            <span>📈 ${GOAL_FAMILIARITY_TARGET_LABELS[currentCard.stageGoal.targetFamiliarity]}</span>
            <span>🎯 ${currentCard.stageGoal.targetPracticeCount} 次</span>
            ${isCompleted ? `<span style="color:var(--success)">✅ 已完成</span>` : ''}
          </div>
        </div>
      `;
    }

    currentEl.innerHTML = `
      <div class="route-run-current-label">当前步骤 ${activeRun.currentIndex + 1} / ${total}</div>
      <div class="route-run-current-title">${escapeHtml(currentCard.title)}</div>
      <div class="route-run-current-meta">
        <span>📍 ${escapeHtml(currentCard.zone || '未设展区')}</span>
        <span>⏱️ ${currentCard.durationMinutes} 分钟</span>
        <span class="fam-tag fam-${currentCard.familiarity}" style="background:${FAMILIARITY_COLORS[currentCard.familiarity]}">${FAMILIARITY_LABELS[currentCard.familiarity]}</span>
        <span>🔄 已试讲 ${currentCard.practiceCount} 次</span>
        ${currentCard.isReviewed ? '<span style="color:var(--success)">✅ 已复盘</span>' : '<span style="color:var(--warning)">⏳ 待复盘</span>'}
      </div>
      ${goalSection}
      ${currentCard.keywords.length > 0 ? `
        <div class="run-detail-section">
          <div class="run-detail-label">🔑 关键词</div>
          <div class="tag-cloud">${currentCard.keywords.map((k) => `<span class="tag-item">${escapeHtml(k)}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${currentCard.errorPoints.length > 0 ? `
        <div class="run-detail-section">
          <div class="run-detail-label">⚠️ 易错点</div>
          <div class="tag-cloud">${currentCard.errorPoints.map((e) => `<span class="tag-item error">${escapeHtml(e)}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${currentCard.alternatives.length > 0 ? `
        <div class="run-detail-section">
          <div class="run-detail-label">💬 替代表达</div>
          <div class="tag-cloud">${currentCard.alternatives.map((a) => `<span class="tag-item alt">${escapeHtml(a)}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${currentCard.reviewNote ? `
        <div class="run-detail-section">
          <div class="run-detail-label">📝 复盘备注</div>
          <div class="review-note">${escapeHtml(currentCard.reviewNote)}</div>
        </div>
      ` : ''}
    `;
  }

  const completedSteps: string[] = [];
  for (let i = 0; i < activeRun.currentIndex; i++) {
    const stepId = activeRun.allStepIds[i];
    const card = cardMap.get(stepId);
    const isPracticed = activeRun.runRecord.practicedCardIds.includes(stepId);
    const title = card ? card.title : '(缺失条目)';
    completedSteps.push(`
      <div class="route-run-upcoming-item ${isPracticed ? 'practiced' : 'skipped'}">
        <span class="status-icon">${isPracticed ? '✅' : '⏭️'}</span>
        <span>${i + 1}. ${escapeHtml(title)}</span>
      </div>
    `);
  }

  const upcoming: string[] = [];
  for (let i = activeRun.currentIndex + 1; i < Math.min(activeRun.currentIndex + 4, total); i++) {
    const stepId = activeRun.allStepIds[i];
    const card = cardMap.get(stepId);
    const title = card ? card.title : '(缺失条目)';
    const dur = card ? `${card.durationMinutes}分` : '';
    upcoming.push(`
      <div class="route-run-upcoming-item">
        <span class="status-icon">📌</span>
        <span>${i + 1}. ${escapeHtml(title)}</span>
        <span style="margin-left:auto;color:var(--text-muted);">${dur}</span>
      </div>
    `);
  }

  upcomingEl.innerHTML = `
    ${completedSteps.length > 0 ? `
      <div class="route-run-upcoming-title">已完成 (${completedSteps.length})</div>
      ${completedSteps.join('')}
    ` : ''}
    ${upcoming.length > 0 ? `
      <div class="route-run-upcoming-title" style="margin-top:10px;">即将进行</div>
      ${upcoming.join('')}
    ` : ''}
  `;
}

function practiceCurrentStep(): void {
  if (!activeRun) return;
  const cardId = activeRun.allStepIds[activeRun.currentIndex];
  const card = cards.find((c) => c.id === cardId);

  if (!card) {
    toast('该条目已不存在，无法记录试讲，请跳过', 'warning');
    return;
  }

  activeRun.runRecord.practicedCardIds.push(cardId);

  const now = Date.now();
  card.practiceCount++;
  card.lastPracticedAt = now;
  card.practiceHistory = [...(card.practiceHistory || []), now];
  card.updatedAt = now;

  activeRun.currentIndex++;
  renderRunModal();
}

function skipCurrentStep(): void {
  if (!activeRun) return;
  const cardId = activeRun.allStepIds[activeRun.currentIndex];
  activeRun.runRecord.skippedCardIds.push(cardId);
  activeRun.currentIndex++;
  renderRunModal();
}

function finishRouteRun(): void {
  if (!activeRun) return;

  const note = (document.getElementById('route-run-note') as HTMLTextAreaElement).value.trim();
  activeRun.runRecord.note = note;
  activeRun.runRecord.finishedAt = Date.now();

  routeRuns.push(activeRun.runRecord);

  const route = routes.find((r) => r.id === activeRun!.route.id);
  if (route) {
    route.lastRunAt = activeRun.runRecord.finishedAt;
    route.updatedAt = Date.now();
  }

  persist();
  closeModal('route-run-modal');
  const practiced = activeRun.runRecord.practicedCardIds.length;
  const skipped = activeRun.runRecord.skippedCardIds.length;
  activeRun = null;
  render();
  toast(`路线执行完成！已练习 ${practiced} 项，跳过 ${skipped} 项`, 'success');
}

function bindEvents(): void {
  document.getElementById('btn-add')!.addEventListener('click', () => openCardEditor(null));
  document.getElementById('btn-save-card')!.addEventListener('click', saveCardFromForm);

  document.getElementById('btn-check')!.addEventListener('click', showCheckResults);
  document.getElementById('btn-daily-plan')!.addEventListener('click', showDailyPlan);

  document.getElementById('btn-add-route')!.addEventListener('click', () => {
    switchTab('routes');
    openRouteEditor(null);
  });
  document.getElementById('btn-save-route')!.addEventListener('click', saveRouteFromForm);
  document.getElementById('btn-recommend-route')!.addEventListener('click', () => {
    switchTab('routes');
    openRecommendedRoute();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as 'cards' | 'routes';
      if (tab) switchTab(tab);
    });
  });

  (document.getElementById('route-sort-by') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortBy = (e.target as HTMLSelectElement).value as RouteSortBy;
    renderRoutes();
  });
  (document.getElementById('route-sort-order') as HTMLSelectElement).addEventListener('change', (e) => {
    routeSortOrder = (e.target as HTMLSelectElement).value as 'asc' | 'desc';
    renderRoutes();
  });
  (document.getElementById('route-show-archived') as HTMLInputElement).addEventListener('change', (e) => {
    showArchivedRoutes = (e.target as HTMLInputElement).checked;
    renderRoutes();
  });

  document.getElementById('btn-run-practice')!.addEventListener('click', practiceCurrentStep);
  document.getElementById('btn-run-skip')!.addEventListener('click', skipCurrentStep);
  document.getElementById('btn-run-finish')!.addEventListener('click', finishRouteRun);
  document.getElementById('btn-run-finish-early')!.addEventListener('click', () => {
    if (!activeRun) return;
    const practiced = activeRun.runRecord.practicedCardIds.length;
    const skipped = activeRun.runRecord.skippedCardIds.length;
    const remaining = activeRun.allStepIds.length - practiced - skipped;
    if (remaining > 0) {
      showConfirm('结束路线', `还有 ${remaining} 个步骤未完成，确认提前结束本次路线执行？`, finishRouteRun);
    } else {
      finishRouteRun();
    }
  });

  document.querySelectorAll('input[name="rf-source"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      routeEditorSource = (e.target as HTMLInputElement).value as 'all' | 'filtered';
      renderRouteEditor();
    });
  });
  document.getElementById('btn-quick-add-zones')!.addEventListener('click', quickAddByZones);
  document.getElementById('btn-clear-steps')!.addEventListener('click', () => {
    if (!editingRoute) return;
    if (editingRoute.stepIds.length === 0) return;
    showConfirm('清空步骤', '确认清空所有已选步骤？', () => {
      if (editingRoute) {
        editingRoute.stepIds = [];
        renderRouteEditor();
        toast('已清空步骤', 'info');
      }
    });
  });

  document.getElementById('btn-export-json')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0 && routes.length === 0) { toast('当前没有可导出内容', 'warning'); return; }
    const content = exportToJson(list, routes, routeRuns);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.json`, 'application/json');
    toast(`已导出 ${list.length} 个条目、${routes.length} 条路线为 JSON`, 'success');
  });

  document.getElementById('btn-export-md')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0 && routes.length === 0) { toast('当前没有可导出内容', 'warning'); return; }
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
        ['card-modal', 'daily-modal', 'check-modal', 'confirm-modal', 'route-modal', 'route-run-modal', 'route-detail-modal'].forEach((id) => {
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
  render();

  const quickCheck = runChecks(cards).filter((r) => r.severity !== 'info');
  if (quickCheck.length > 0) {
    setTimeout(() => {
      toast(`检测到 ${quickCheck.length} 项内容检查待关注，点击「内容检查」查看详情`, 'warning');
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', init);
