import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginatedListState } from "@/lib/windowedList";

type TablePaginationControlsProps<T> = {
    pageState: PaginatedListState<T>;
    onPageChange: (page: number) => void;
};

export const TablePaginationControls = <T,>({
    pageState,
    onPageChange,
}: TablePaginationControlsProps<T>) => {
    const canGoPrevious = pageState.page > 1;
    const canGoNext = pageState.page < pageState.pageCount;

    return (
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
                {pageState.total === 0
                    ? "0 resultados"
                    : `${pageState.start}-${pageState.end} de ${pageState.total} resultados`}
            </span>
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canGoPrevious}
                    onClick={() => onPageChange(pageState.page - 1)}
                >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Anterior
                </Button>
                <span className="min-w-24 text-center">
                    Página {pageState.page} de {pageState.pageCount}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canGoNext}
                    onClick={() => onPageChange(pageState.page + 1)}
                >
                    Siguiente
                    <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};
