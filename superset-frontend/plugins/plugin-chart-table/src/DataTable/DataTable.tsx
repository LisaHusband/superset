/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-disable import/no-extraneous-dependencies */
import {
  useCallback,
  useRef,
  ReactNode,
  HTMLProps,
  MutableRefObject,
  CSSProperties,
  DragEvent,
  useEffect,
} from 'react';
import { styled, typedMemo, usePrevious } from '@superset-ui/core';
import {
  useTable,
  usePagination,
  useSortBy,
  useGlobalFilter,
  useColumnOrder,
  PluginHook,
  TableOptions,
  FilterType,
  IdType,
  Row,
} from 'react-table';
import { matchSorter, rankings } from 'match-sorter';
import { isEqual } from 'lodash';
import { Space } from '@superset-ui/core/components';
import GlobalFilter, { GlobalFilterProps } from './components/GlobalFilter';
import SelectPageSize, {
  SelectPageSizeProps,
  SizeOption,
} from './components/SelectPageSize';
import SimplePagination from './components/Pagination';
import useSticky from './hooks/useSticky';
import { PAGE_SIZE_OPTIONS } from '../consts';
import { sortAlphanumericCaseInsensitive } from './utils/sortAlphanumericCaseInsensitive';
import { SearchOption, SortByItem } from '../types';
import SearchSelectDropdown from './components/SearchSelectDropdown';

export interface DataTableProps<D extends object> extends TableOptions<D> {
  tableClassName?: string;
  searchInput?: boolean | GlobalFilterProps<D>['searchInput'];
  selectPageSize?: boolean | SelectPageSizeProps['selectRenderer'];
  pageSizeOptions?: SizeOption[]; // available page size options
  maxPageItemCount?: number;
  hooks?: PluginHook<D>[]; // any additional hooks
  width?: string | number;
  height?: string | number;
  serverPagination?: boolean;
  onServerPaginationChange: (pageNumber: number, pageSize: number) => void;
  serverPaginationData: {
    pageSize?: number;
    currentPage?: number;
    sortBy?: SortByItem[];
    searchColumn?: string;
  };
  pageSize?: number;
  noResults?: string | ((filterString: string) => ReactNode);
  sticky?: boolean;
  rowCount: number;
  wrapperRef?: MutableRefObject<HTMLDivElement>;
  onColumnOrderChange: () => void;
  renderGroupingHeaders?: () => JSX.Element;
  renderTimeComparisonDropdown?: () => JSX.Element;
  handleSortByChange: (sortBy: SortByItem[]) => void;
  sortByFromParent: SortByItem[];
  manualSearch?: boolean;
  onSearchChange?: (searchText: string) => void;
  initialSearchText?: string;
  searchInputId?: string;
  onSearchColChange: (searchCol: string) => void;
  searchOptions: SearchOption[];
}

export interface RenderHTMLCellProps extends HTMLProps<HTMLTableCellElement> {
  cellContent: ReactNode;
}

const sortTypes = {
  alphanumeric: sortAlphanumericCaseInsensitive,
};

const StyledSpace = styled(Space)`
  display: flex;
  justify-content: flex-end;

  .search-select-container {
    display: flex;
  }

  .search-by-label {
    align-self: center;
    margin-right: 4px;
  }
`;

const StyledRow = styled.div`
  display: flex;
`;

// Be sure to pass our updateMyData and the skipReset option
export default typedMemo(function DataTable<D extends object>({
  tableClassName,
  columns,
  data,
  serverPaginationData,
  width: initialWidth = '100%',
  height: initialHeight = 300,
  pageSize: initialPageSize = 0,
  initialState: initialState_ = {},
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  maxPageItemCount = 9,
  sticky: doSticky,
  searchInput = true,
  onServerPaginationChange,
  rowCount,
  selectPageSize,
  noResults: noResultsText = 'No data found',
  hooks,
  serverPagination,
  wrapperRef: userWrapperRef,
  onColumnOrderChange,
  renderGroupingHeaders,
  renderTimeComparisonDropdown,
  handleSortByChange,
  sortByFromParent = [],
  manualSearch = false,
  onSearchChange,
  initialSearchText,
  searchInputId,
  onSearchColChange,
  searchOptions,
  ...moreUseTableOptions
}: DataTableProps<D>): JSX.Element {
  const tableHooks: PluginHook<D>[] = [
    useGlobalFilter,
    useSortBy,
    usePagination,
    useColumnOrder,
    doSticky ? useSticky : [],
    hooks || [],
  ].flat();

  const columnNames = Object.keys(data?.[0] || {});
  const previousColumnNames = usePrevious(columnNames);
  const resultsSize = serverPagination ? rowCount : data.length;
  const sortByRef = useRef([]); // cache initial `sortby` so sorting doesn't trigger page reset
  const pageSizeRef = useRef([initialPageSize, resultsSize]);
  const hasPagination = initialPageSize > 0 && resultsSize > 0; // pageSize == 0 means no pagination
  const hasGlobalControl =
    hasPagination || !!searchInput || renderTimeComparisonDropdown;
  const initialState = {
    ...initialState_,
    // zero length means all pages, the `usePagination` plugin does not
    // understand pageSize = 0
    // sortBy: sortByRef.current,
    sortBy: serverPagination ? sortByFromParent : sortByRef.current,
    pageSize: initialPageSize > 0 ? initialPageSize : resultsSize || 10,
  };
  const defaultWrapperRef = useRef<HTMLDivElement>(null);
  const globalControlRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const wrapperRef = userWrapperRef || defaultWrapperRef;
  const paginationData = JSON.stringify(serverPaginationData);

  const defaultGetTableSize = useCallback(() => {
    if (wrapperRef.current) {
      // `initialWidth` and `initialHeight` could be also parameters like `100%`
      // `Number` returns `NaN` on them, then we fallback to computed size
      const width = Number(initialWidth) || wrapperRef.current.clientWidth;
      const height =
        (Number(initialHeight) || wrapperRef.current.clientHeight) -
        (globalControlRef.current?.clientHeight || 0) -
        (paginationRef.current?.clientHeight || 0);
      return { width, height };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialHeight,
    initialWidth,
    wrapperRef,
    hasPagination,
    hasGlobalControl,
    paginationRef,
    resultsSize,
    paginationData,
  ]);

  const defaultGlobalFilter: FilterType<D> = useCallback(
    (rows: Row<D>[], columnIds: IdType<D>[], filterValue: string) => {
      // allow searching by "col1_value col2_value"
      const joinedString = (row: Row<D>) =>
        columnIds.map(x => row.values[x]).join(' ');
      return matchSorter(rows, filterValue, {
        keys: [...columnIds, joinedString],
        threshold: rankings.ACRONYM,
      }) as typeof rows;
    },
    [],
  );

  const {
    getTableProps,
    getTableBodyProps,
    prepareRow,
    headerGroups,
    footerGroups,
    page,
    pageCount,
    gotoPage,
    preGlobalFilteredRows,
    setGlobalFilter,
    setPageSize: setPageSize_,
    wrapStickyTable,
    setColumnOrder,
    allColumns,
    state: {
      pageIndex,
      pageSize,
      globalFilter: filterValue,
      sticky = {},
      sortBy,
    },
  } = useTable<D>(
    {
      columns,
      data,
      initialState,
      getTableSize: defaultGetTableSize,
      globalFilter: defaultGlobalFilter,
      sortTypes,
      autoResetSortBy: !isEqual(columnNames, previousColumnNames),
      manualSortBy: !!serverPagination,
      ...moreUseTableOptions,
    },
    ...tableHooks,
  );

  const handleSearchChange = useCallback(
    (query: string) => {
      if (manualSearch && onSearchChange) {
        onSearchChange(query);
      } else {
        setGlobalFilter(query);
      }
    },
    [manualSearch, onSearchChange, setGlobalFilter],
  );

  // updating the sort by to the own State of table viz
  useEffect(() => {
    const serverSortBy = serverPaginationData?.sortBy || [];

    if (serverPagination && !isEqual(sortBy, serverSortBy)) {
      if (Array.isArray(sortBy) && sortBy.length > 0) {
        const [sortByItem] = sortBy;
        const matchingColumn = columns.find(col => col?.id === sortByItem?.id);

        if (matchingColumn && 'columnKey' in matchingColumn) {
          const sortByWithColumnKey: SortByItem = {
            ...sortByItem,
            key: (matchingColumn as { columnKey: string }).columnKey,
          };

          handleSortByChange([sortByWithColumnKey]);
        }
      } else {
        handleSortByChange([]);
      }
    }
  }, [sortBy]);

  // make setPageSize accept 0
  const setPageSize = (size: number) => {
    if (serverPagination) {
      onServerPaginationChange(0, size);
    }
    // keep the original size if data is empty
    if (size || resultsSize !== 0) {
      setPageSize_(size === 0 ? resultsSize : size);
    }
  };

  const noResults =
    typeof noResultsText === 'function'
      ? noResultsText(filterValue as string)
      : noResultsText;

  const getNoResults = () => <div className="dt-no-results">{noResults}</div>;

  if (!columns || columns.length === 0) {
    return (
      wrapStickyTable ? wrapStickyTable(getNoResults) : getNoResults()
    ) as JSX.Element;
  }

  const shouldRenderFooter = columns.some(x => !!x.Footer);

  let columnBeingDragged = -1;

  const onDragStart = (e: DragEvent) => {
    const el = e.target as HTMLTableCellElement;
    columnBeingDragged = allColumns.findIndex(
      col => col.id === el.dataset.columnName,
    );
    e.dataTransfer.setData('text/plain', `${columnBeingDragged}`);
  };

  const onDrop = (e: DragEvent) => {
    const el = e.target as HTMLTableCellElement;
    const newPosition = allColumns.findIndex(
      col => col.id === el.dataset.columnName,
    );

    if (newPosition !== -1) {
      const currentCols = allColumns.map(c => c.id);
      const colToBeMoved = currentCols.splice(columnBeingDragged, 1);
      currentCols.splice(newPosition, 0, colToBeMoved[0]);
      setColumnOrder(currentCols);
      // toggle value in TableChart to trigger column width recalc
      onColumnOrderChange();
    }
    e.preventDefault();
  };

  const renderTable = () => (
    <table {...getTableProps({ className: tableClassName })}>
      <thead>
        {renderGroupingHeaders ? renderGroupingHeaders() : null}
        {headerGroups.map(headerGroup => {
          const { key: headerGroupKey, ...headerGroupProps } =
            headerGroup.getHeaderGroupProps();
          return (
            <tr key={headerGroupKey || headerGroup.id} {...headerGroupProps}>
              {headerGroup.headers.map(column =>
                column.render('Header', {
                  key: column.id,
                  ...column.getSortByToggleProps(),
                  onDragStart,
                  onDrop,
                }),
              )}
            </tr>
          );
        })}
      </thead>
      <tbody {...getTableBodyProps()}>
        {page && page.length > 0 ? (
          page.map(row => {
            prepareRow(row);
            const { key: rowKey, ...rowProps } = row.getRowProps();
            return (
              <tr key={rowKey || row.id} {...rowProps} role="row">
                {row.cells.map(cell =>
                  cell.render('Cell', { key: cell.column.id }),
                )}
              </tr>
            );
          })
        ) : (
          <tr>
            <td className="dt-no-results" colSpan={columns.length}>
              {noResults}
            </td>
          </tr>
        )}
      </tbody>
      {shouldRenderFooter && (
        <tfoot>
          {footerGroups.map(footerGroup => {
            const { key: footerGroupKey, ...footerGroupProps } =
              footerGroup.getHeaderGroupProps();
            return (
              <tr
                key={footerGroupKey || footerGroup.id}
                {...footerGroupProps}
                role="row"
              >
                {footerGroup.headers.map(column =>
                  column.render('Footer', { key: column.id }),
                )}
              </tr>
            );
          })}
        </tfoot>
      )}
    </table>
  );

  // force update the pageSize when it's been update from the initial state
  if (
    pageSizeRef.current[0] !== initialPageSize ||
    // when initialPageSize stays as zero, but total number of records changed,
    // we'd also need to update page size
    (initialPageSize === 0 && pageSizeRef.current[1] !== resultsSize)
  ) {
    pageSizeRef.current = [initialPageSize, resultsSize];
    setPageSize(initialPageSize);
  }

  const paginationStyle: CSSProperties = sticky.height
    ? {}
    : { visibility: 'hidden' };

  let resultPageCount = pageCount;
  let resultCurrentPageSize = pageSize;
  let resultCurrentPage = pageIndex;
  let resultOnPageChange: (page: number) => void = gotoPage;
  if (serverPagination) {
    const serverPageSize = serverPaginationData?.pageSize ?? initialPageSize;
    resultPageCount = Math.ceil(rowCount / serverPageSize);
    if (!Number.isFinite(resultPageCount)) {
      resultPageCount = 0;
    }
    resultCurrentPageSize = serverPageSize;
    const foundPageSizeIndex = pageSizeOptions.findIndex(
      ([option]) => option >= resultCurrentPageSize,
    );
    if (foundPageSizeIndex === -1) {
      resultCurrentPageSize = 0;
    }
    resultCurrentPage = serverPaginationData?.currentPage ?? 0;
    resultOnPageChange = (pageNumber: number) =>
      onServerPaginationChange(pageNumber, serverPageSize);
  }

  return (
    <div
      ref={wrapperRef}
      style={{ width: initialWidth, height: initialHeight }}
    >
      {hasGlobalControl ? (
        <div ref={globalControlRef} className="form-inline dt-controls">
          <StyledRow className="row">
            <div
              className={renderTimeComparisonDropdown ? 'col-sm-4' : 'col-sm-5'}
            >
              {hasPagination ? (
                <SelectPageSize
                  total={resultsSize}
                  current={resultCurrentPageSize}
                  options={pageSizeOptions}
                  selectRenderer={
                    typeof selectPageSize === 'boolean'
                      ? undefined
                      : selectPageSize
                  }
                  onChange={setPageSize}
                />
              ) : null}
            </div>
            {searchInput ? (
              <StyledSpace
                className={
                  renderTimeComparisonDropdown ? 'col-sm-7' : 'col-sm-8'
                }
              >
                {serverPagination && (
                  <div className="search-select-container">
                    <span className="search-by-label">Search by: </span>
                    <SearchSelectDropdown
                      searchOptions={searchOptions}
                      value={serverPaginationData?.searchColumn || ''}
                      onChange={onSearchColChange}
                    />
                  </div>
                )}
                <GlobalFilter<D>
                  searchInput={
                    typeof searchInput === 'boolean' ? undefined : searchInput
                  }
                  preGlobalFilteredRows={preGlobalFilteredRows}
                  setGlobalFilter={
                    manualSearch ? handleSearchChange : setGlobalFilter
                  }
                  filterValue={manualSearch ? initialSearchText : filterValue}
                  id={searchInputId}
                  serverPagination={!!serverPagination}
                  rowCount={rowCount}
                />
              </StyledSpace>
            ) : null}
            {renderTimeComparisonDropdown ? (
              <div
                className="col-sm-1"
                style={{ float: 'right', marginTop: '6px' }}
              >
                {renderTimeComparisonDropdown()}
              </div>
            ) : null}
          </StyledRow>
        </div>
      ) : null}
      {wrapStickyTable ? wrapStickyTable(renderTable) : renderTable()}
      {hasPagination && resultPageCount > 1 ? (
        <SimplePagination
          ref={paginationRef}
          style={paginationStyle}
          maxPageItemCount={maxPageItemCount}
          pageCount={resultPageCount}
          currentPage={resultCurrentPage}
          onPageChange={resultOnPageChange}
        />
      ) : null}
    </div>
  );
});
