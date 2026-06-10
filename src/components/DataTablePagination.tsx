import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginatedListState } from "@/lib/windowedList";

type DataTablePaginationProps = Pick<
    PaginatedListState<unknown>,
    "total" | "page" | "pageCount" | "start" | "end"
> & {
    onPageChange: (page: number) => void;
};

const getVisiblePages = (page: number, pageCount: number) => {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);

    const pages = new Set([1, pageCount, page - 1, page, page + 1]);
    return Array.from(pages)
        .filter((item) => item >= 1 && item <= pageCount)
        .sort((left, right) => left - right);
};

export const DataTablePagination = ({
    total,
    page,
    pageCount,
    start,
    end,
    onPageChange,
}: DataTablePaginationProps) => {
    const visiblePages = getVisiblePages(page, pageCount);

    return (
        <div className="flex min-h-10 flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
                Mostrando <span className="font-medium text-foreground">{start}-{end}</span> de{" "}
                <span className="font-medium text-foreground">{total}</span>
            </p>

            {pageCount > 1 && (
                <div className="flex items-center justify-end gap-1" aria-label="Paginacion de resultados">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                        aria-label="Pagina anterior"
                        title="Pagina anterior"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    {visiblePages.map((pageNumber, index) => {
                        const previousPage = visiblePages[index - 1];
                        const hasGap = previousPage !== undefined && pageNumber - previousPage > 1;

                        return (
                            <div key={pageNumber} className="flex items-center gap-1">
                                {hasGap && <span className="flex h-8 w-5 items-center justify-center text-xs text-muted-foreground">...</span>}
                                <Button
                                    type="button"
                                    variant={pageNumber === page ? "default" : "outline"}
                                    size="icon"
                                    className="h-8 w-8 text-xs"
                                    onClick={() => onPageChange(pageNumber)}
                                    aria-label={`Ir a la pagina ${pageNumber}`}
                                    aria-current={pageNumber === page ? "page" : undefined}
                                >
                                    {pageNumber}
                                </Button>
                            </div>
                        );
                    })}

                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= pageCount}
                        aria-label="Pagina siguiente"
                        title="Pagina siguiente"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
};
