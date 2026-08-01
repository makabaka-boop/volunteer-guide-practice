import type {
  PracticeCard,
  FilterCriteria,
  FamiliarityLevel,
  CheckResult,
  DailyPracticePlan,
  GoalStatus,
  StageGoal,
  GoalFamiliarityTarget
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
  getUniqueZones
} from './storage';
import {
  formatDate,
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
  formatDaysRemaining
} from './utils';

let cards: PracticeCard[] = [];
let selectedIds: Set<string> = new Set();
let editingCard: PracticeCard | null = null;
let sortBy: string = 'updated';
let sortOrder: 'asc' | 'desc' = 'desc';

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
}

function render(): void {
  renderZoneChips();
  renderStats();
  renderCards();
  renderBatchPanel();
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

function bindEvents(): void {
  document.getElementById('btn-add')!.addEventListener('click', () => openCardEditor(null));
  document.getElementById('btn-save-card')!.addEventListener('click', saveCardFromForm);

  document.getElementById('btn-check')!.addEventListener('click', showCheckResults);
  document.getElementById('btn-daily-plan')!.addEventListener('click', showDailyPlan);

  document.getElementById('btn-export-json')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0) { toast('当前列表为空，无可导出内容', 'warning'); return; }
    const content = exportToJson(list);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.json`, 'application/json');
    toast(`已导出 ${list.length} 个条目为 JSON`, 'success');
  });

  document.getElementById('btn-export-md')!.addEventListener('click', () => {
    const list = getFilteredSortedCards();
    if (list.length === 0) { toast('当前列表为空，无可导出内容', 'warning'); return; }
    const content = exportToMarkdown(list);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(content, `展馆讲解训练台_${ts}.md`, 'text/markdown');
    toast(`已导出 ${list.length} 个条目为 Markdown`, 'success');
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
        ['card-modal', 'daily-modal', 'check-modal', 'confirm-modal'].forEach((id) => {
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
