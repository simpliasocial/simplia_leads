export const WINDOWED_LIST_VISIBLE_ROWS = 10;
export const WINDOWED_LIST_MAX_RENDERED_ROWS = 20;
export const WINDOWED_TABLE_MAX_HEIGHT_PX = 760;

export type PaginatedListState<T> = {
    total: number;
    page: number;
    pageCount: number;
    pageSize: number;
    start: number;
    end: number;
    visibleItems: T[];
    hasVerticalScroll: boolean;
};

export const buildPaginatedListState = <T,>(
    items: T[],
    requestedPage: number,
    pageSize = WINDOWED_LIST_MAX_RENDERED_ROWS,
): PaginatedListState<T> => {
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
    const offset = (page - 1) * safePageSize;
    const visibleItems = items.slice(offset, offset + safePageSize);

    return {
        total: items.length,
        page,
        pageCount,
        pageSize: safePageSize,
        start: items.length === 0 ? 0 : offset + 1,
        end: Math.min(offset + visibleItems.length, items.length),
        visibleItems,
        hasVerticalScroll: visibleItems.length > WINDOWED_LIST_VISIBLE_ROWS,
    };
};

export const buildWindowedListState = buildPaginatedListState;
