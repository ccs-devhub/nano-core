<script setup lang="ts">
import { computed, ref } from 'vue';

import { t } from '../lib/i18n';

/**
 * The data table: search across every cell, capped pages with
 * prev/next, and a status footer (rows shown / total + the update
 * stamp). Column labels come from the descriptor.
 */
const props = withDefaults(defineProps<{
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  pageSize?: number;
  updatedAt?: string;
}>(), {
  pageSize: 8,
  updatedAt: '',
});

const query = ref('');
const page = ref(0);

const filtered = computed((): Record<string, unknown>[] => {
  const RAW = query.value.trim().toLowerCase();

  if (!RAW) {
    return props.rows;
  }

  /* Column-scoped search. Typing a column name (label or key)
     followed by a colon filters that column only, e.g. 'user: kyo'.
     Plain text searches every column. */
  const SCOPED = RAW.match(/^([\p{L}\p{N}_ ]+):\s*(.*)$/u);
  let target_columns = props.columns;
  let needle = RAW;

  if (SCOPED) {
    const COLUMN = props.columns.find(
      (column: { key: string; label: string }): boolean => {
        return column.key.toLowerCase() === SCOPED[1].trim() ||
          column.label.toLowerCase() === SCOPED[1].trim();
      }
    );

    if (COLUMN) {
      target_columns = [COLUMN];
      needle = SCOPED[2];
    }
  }

  if (!needle) {
    return props.rows;
  }
  return props.rows.filter(
    (row: Record<string, unknown>): boolean => {
      return target_columns.some(
        (column: { key: string }): boolean => {
          return String(row[column.key] ?? '')
            .toLowerCase()
            .includes(needle);
        }
      );
    }
  );
});

const page_count = computed((): number => {
  return Math.max(1, Math.ceil(filtered.value.length / props.pageSize));
});

const visible = computed((): Record<string, unknown>[] => {
  const CURRENT = Math.min(page.value, page_count.value - 1);
  return filtered.value.slice(
    CURRENT * props.pageSize,
    (CURRENT + 1) * props.pageSize
  );
});

function search(value: string): void {
  query.value = value;
  page.value = 0;
}

function step(delta: number): void {
  page.value = Math.min(
    Math.max(0, page.value + delta),
    page_count.value - 1
  );
}
</script>

<template>
  <div class="ui-table">
    <div
      v-if="rows.length > 0"
      class="table-tools"
    >
      <input
        type="text"
        class="search"
        :aria-label="t('search_aria')"
        :placeholder="t('search_placeholder')"
        :value="query"
        @input="search(($event.target as HTMLInputElement).value)"
      >
    </div>

    <table>
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in visible"
          :key="index"
        >
          <td
            v-for="column in columns"
            :key="column.key"
          >
            {{ row[column.key] ?? '' }}
          </td>
        </tr>
        <tr v-if="visible.length === 0">
          <td
            :colspan="columns.length"
            class="dim"
          >
            {{ t('nothing_here') }}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="table-foot dim">
      <span class="foot-left">
        {{ visible.length }} / {{ filtered.length }}
        {{ t('rows') }}
        <template v-if="page_count > 1">
          <button
            class="mini"
            :disabled="page === 0"
            @click="step(-1)"
          >
            &lt;
          </button>
          {{ t('page') }}
          {{ Math.min(page, page_count - 1) + 1 }} /
          {{ page_count }}
          <button
            class="mini"
            :disabled="page >= page_count - 1"
            @click="step(1)"
          >
            &gt;
          </button>
        </template>
      </span>
      <span
        v-if="updatedAt"
        class="stamp"
      >{{ t('updated', { time: updatedAt }) }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.table-tools {
  margin-bottom: t.$grid;

  .search {
    width: 220px;
    max-width: 100%;
    font-size: 12px;
    padding: calc(t.$grid / 2) t.$grid;
  }
}

.table-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: t.$grid;
  font-size: 10px;
  margin-top: calc(t.$grid / 2);

  .foot-left {
    display: inline-flex;
    align-items: center;
    gap: t.$grid;
  }

  .stamp {
    letter-spacing: 0.5px;
  }
}

.mini {
  padding: 0 6px;
  font-size: 11px;
}
</style>
