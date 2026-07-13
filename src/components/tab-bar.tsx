"use client";
import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Tab } from "@/server/tabs-repo";
import { tabDndId } from "@/components/dashboard-logic";

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  autoEditId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
};

function SortableTab({
  tab, active, editing, canDelete, onSelect, onStartEdit, onCommit, onCancel, onDelete,
}: {
  tab: Tab;
  active: boolean;
  editing: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabDndId(tab.id),
    data: { type: "tab" },
  });
  const [draft, setDraft] = useState(tab.name);
  useEffect(() => { if (editing) setDraft(tab.name); }, [editing, tab.name]);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function commit() {
    const next = draft.trim();
    if (next && next !== tab.name) onCommit(next);
    else onCancel();
  }

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-center">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          className="w-24 rounded-md bg-transparent px-2 py-1 text-sm font-medium text-slate-800 outline-none ring-1 ring-primary-500 dark:text-slate-100"
        />
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={onSelect}
          onDoubleClick={onStartEdit}
          className={`relative px-3 py-2 text-sm font-medium transition-colors ${
            active
              ? "text-primary-600 dark:text-primary-400"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {tab.name}
          {active && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600 dark:bg-primary-400" />
          )}
        </button>
      )}
      {active && canDelete && !editing && (
        <button
          type="button"
          aria-label="Delete tab"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="mr-1 grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-danger/10 hover:text-danger"
        >
          <span className="text-xs leading-none">✕</span>
        </button>
      )}
    </div>
  );
}

export function TabBar({
  tabs, activeTabId, autoEditId, onSelect, onAdd, onRename, onDelete, canDelete,
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => { setEditingId(autoEditId); }, [autoEditId]);

  return (
    <div className="flex items-center gap-1">
      <SortableContext items={tabs.map((t) => tabDndId(t.id))} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => (
          <SortableTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            editing={editingId === tab.id}
            canDelete={canDelete}
            onSelect={() => onSelect(tab.id)}
            onStartEdit={() => setEditingId(tab.id)}
            onCommit={(name) => { setEditingId(null); onRename(tab.id, name); }}
            onCancel={() => setEditingId(null)}
            onDelete={() => onDelete(tab.id)}
          />
        ))}
      </SortableContext>
      <button
        type="button"
        aria-label="Add tab"
        title="Add tab"
        onClick={onAdd}
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
      >
        <span className="text-base leading-none">+</span>
      </button>
    </div>
  );
}
