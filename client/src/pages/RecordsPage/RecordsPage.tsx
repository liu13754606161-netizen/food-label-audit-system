import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Eye, Edit, Download, X } from "lucide-react";
import { toast } from "sonner";
import dayjs from "dayjs";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  getRecords,
  getRecordById,
  exportRecord,
} from "@client/src/api/index";
import type {
  RecordItem,
  RecordType,
  RecordStatus,
  RecordListParams,
} from "@shared/api.interface";

const TYPE_OPTIONS: { value: RecordType | "all"; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "audit", label: "审核" },
  { value: "generate", label: "生成" },
];

const STATUS_OPTIONS: { value: RecordStatus | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];

const TYPE_LABEL_MAP: Record<RecordType, string> = {
  audit: "审核",
  generate: "生成",
};

const STATUS_LABEL_MAP: Record<RecordStatus, string> = {
  pending: "待处理",
  processing: "处理中",
  success: "成功",
  failed: "失败",
};

const STATUS_VARIANT_MAP: Record<RecordStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  processing: "secondary",
  success: "default",
  failed: "destructive",
};

const PAGE_SIZE = 10;

function RecordsPage() {
  const navigate = useNavigate();
  
  // 筛选状态
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<RecordStatus | "all">("all");
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  
  // 分页状态
  const [page, setPage] = useState(1);
  
  // 详情抽屉状态
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // 数据状态
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // 构建查询参数
  const queryParams = useMemo((): RecordListParams => {
    const params: RecordListParams = {
      page,
      pageSize: PAGE_SIZE,
    };
    
    if (typeFilter !== "all") {
      params.type = typeFilter;
    }
    
    if (dateRange.from) {
      params.startDate = dayjs(dateRange.from).format("YYYY-MM-DD");
    }
    if (dateRange.to) {
      params.endDate = dayjs(dateRange.to).format("YYYY-MM-DD");
    }
    
    return params;
  }, [page, typeFilter, dateRange]);

  // 获取记录列表
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getRecords(queryParams);
      setRecords(response.items);
      setTotal(response.total);
    } catch (error) {
      toast.error("获取记录列表失败");
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  // 获取记录详情
  const fetchRecordDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await getRecordById(id);
      setSelectedRecord(detail);
    } catch (error) {
      toast.error("获取记录详情失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // 初始加载和参数变化时重新加载
  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 处理筛选变化
  const handleTypeChange = (value: string) => {
    setTypeFilter(value as RecordType | "all");
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value as RecordStatus | "all");
    setPage(1);
  };

  const handleDateRangeChange = (range: { from?: Date; to?: Date }) => {
    setDateRange(range);
    setPage(1);
  };

  const handleResetFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setDateRange({});
    setPage(1);
  };

  // 查看详情
  const handleViewDetail = async (record: RecordItem) => {
    setDrawerOpen(true);
    await fetchRecordDetail(record.id);
  };

  // 重新编辑
  const handleEdit = (record: RecordItem) => {
    if (record.type === "audit") {
      navigate("/audit", { state: { recordId: record.id } });
    } else {
      navigate("/generate", { state: { recordId: record.id } });
    }
  };

  // 导出
  const handleExport = async (record: RecordItem) => {
    try {
      const blob = await exportRecord(record.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${record.fileName}_${record.id}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (error) {
      toast.error("导出失败");
    }
  };

  // 计算总页数
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // 生成页码数组
  const pageNumbers = useMemo(() => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (page <= 3) {
        pages.push(1, 2, 3, 4, "ellipsis", totalPages);
      } else if (page >= totalPages - 2) {
        pages.push(1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, "ellipsis", page - 1, page, page + 1, "ellipsis", totalPages);
      }
    }
    return pages;
  }, [page, totalPages]);

  // 筛选状态样式
  const getFilteredStatusStyle = (record: RecordItem) => {
    if (statusFilter !== "all" && record.status !== statusFilter) {
      return "opacity-50";
    }
    return "";
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">记录管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          统一管理所有历史审核和标签生成记录
        </p>
      </div>

      {/* 筛选区域 */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            {/* 类型筛选 */}
            <div className="flex flex-col gap-1.5 min-w-[160px]">
              <label className="text-sm font-medium">记录类型</label>
              <Select value={typeFilter} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 状态筛选 */}
            <div className="flex flex-col gap-1.5 min-w-[160px]">
              <label className="text-sm font-medium">状态</label>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger>
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 时间范围筛选 */}
            <div className="flex flex-col gap-1.5 min-w-[280px]">
              <label className="text-sm font-medium">创建时间</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-start text-left font-normal w-full"
                  >
                    {dateRange.from ? (
                      dateRange.to ? (
                        <>
                          {dayjs(dateRange.from).format("YYYY-MM-DD")} -{" "}
                          {dayjs(dateRange.to).format("YYYY-MM-DD")}
                        </>
                      ) : (
                        dayjs(dateRange.from).format("YYYY-MM-DD")
                      )
                    ) : (
                      "选择时间范围"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={{
                      from: dateRange.from,
                      to: dateRange.to,
                    }}
                    onSelect={handleDateRangeChange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* 重置按钮 */}
            {(typeFilter !== "all" || statusFilter !== "all" || dateRange.from) && (
              <Button variant="ghost" onClick={handleResetFilters}>
                <X className="h-4 w-4 mr-1" />
                重置筛选
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 记录列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            记录列表
            <span className="text-sm font-normal text-muted-foreground ml-2">
              共 {total} 条记录
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">文件名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                // 加载状态
                Array.from({ length: PAGE_SIZE }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <div className="h-5 w-48 bg-muted animate-pulse rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-16 bg-muted animate-pulse rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-20 bg-muted animate-pulse rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-32 bg-muted animate-pulse rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-24 bg-muted animate-pulse rounded ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : records.length === 0 ? (
                // 空状态
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="h-12 w-12 text-muted-foreground" />
                      <p className="text-muted-foreground">暂无记录</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                // 数据列表
                records.map((record) => (
                  <TableRow
                    key={record.id}
                    className={getFilteredStatusStyle(record)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate max-w-[250px]" title={record.fileName}>
                          {record.fileName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TYPE_LABEL_MAP[record.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT_MAP[record.status]}>
                        {STATUS_LABEL_MAP[record.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dayjs(record.createdAt).format("YYYY-MM-DD HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetail(record)}
                          disabled={detailLoading}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          查看
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(record)}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExport(record)}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          导出
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* 分页 */}
          {!loading && records.length > 0 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                显示 {(page - 1) * PAGE_SIZE + 1} -{" "}
                {Math.min(page * PAGE_SIZE, total)} 条，共 {total} 条
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {pageNumbers.map((num, index) =>
                    num === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${index}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={num}>
                        <PaginationLink
                          isActive={page === num}
                          onClick={() => setPage(num)}
                          className="cursor-pointer"
                        >
                          {num}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详情抽屉 */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} direction="right">
        <DrawerContent className="max-w-lg">
          <DrawerHeader>
            <DrawerTitle>记录详情</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="absolute right-4 top-4">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="px-6 pb-6 overflow-y-auto max-h-[calc(100vh-120px)]">
            {detailLoading ? (
              <div className="space-y-4">
                <div className="h-6 w-48 bg-muted animate-pulse rounded" />
                <div className="h-4 w-full bg-muted animate-pulse rounded" />
                <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
              </div>
            ) : selectedRecord ? (
              <div className="space-y-6">
                {/* 基本信息 */}
                <section>
                  <h3 className="text-lg font-semibold mb-3">基本信息</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">文件名：</span>
                      <span className="font-medium">{selectedRecord.fileName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">类型：</span>
                      <Badge variant="outline" className="ml-1">
                        {TYPE_LABEL_MAP[selectedRecord.type]}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">状态：</span>
                      <Badge variant={STATUS_VARIANT_MAP[selectedRecord.status]} className="ml-1">
                        {STATUS_LABEL_MAP[selectedRecord.status]}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">创建时间：</span>
                      <span>{dayjs(selectedRecord.createdAt).format("YYYY-MM-DD HH:mm:ss")}</span>
                    </div>
                  </div>
                </section>

                {/* 厂商信息 */}
                {selectedRecord.rawData?.manufacturerInfo && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">厂商信息</h3>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground">原料供应商：</span>
                          <p className="font-medium">
                            {selectedRecord.rawData.manufacturerInfo.rawMaterialSupplier.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedRecord.rawData.manufacturerInfo.rawMaterialSupplier.address}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">委托方：</span>
                          <p className="font-medium">
                            {selectedRecord.rawData.manufacturerInfo.delegator.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedRecord.rawData.manufacturerInfo.delegator.address}
                          </p>
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">受委托方：</span>
                        <p className="font-medium">
                          {selectedRecord.rawData.manufacturerInfo.entrustedParty.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {selectedRecord.rawData.manufacturerInfo.entrustedParty.address}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {/* 食品信息 */}
                {selectedRecord.rawData?.foodInfo && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">食品信息</h3>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground">食品名称：</span>
                          <p className="font-medium">{selectedRecord.rawData.foodInfo.name}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">食品类型：</span>
                          <p>{selectedRecord.rawData.foodInfo.type}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">净含量：</span>
                          <p>{selectedRecord.rawData.foodInfo.netContent}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">保质期：</span>
                          <p>{selectedRecord.rawData.foodInfo.shelfLife}</p>
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">配料表：</span>
                        <p className="mt-1">{selectedRecord.rawData.foodInfo.ingredients}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">营养成分：</span>
                        <p className="mt-1">{selectedRecord.rawData.foodInfo.nutrition}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">过敏原：</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedRecord.rawData.foodInfo.allergens.map((allergen, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {allergen}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* 审核结果 */}
                {selectedRecord.resultData?.auditResult && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3">审核结果</h3>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">审核结果：</span>
                          <Badge
                            variant={
                              selectedRecord.resultData.auditResult.pass
                                ? "default"
                                : "destructive"
                            }
                          >
                            {selectedRecord.resultData.auditResult.pass ? "通过" : "不通过"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">总分：</span>
                          <span className="font-semibold">
                            {selectedRecord.resultData.auditResult.totalScore}
                          </span>
                        </div>
                      </div>
                      {selectedRecord.resultData.auditResult.nonComplianceItems.length > 0 && (
                        <div className="mt-4">
                          <span className="text-sm text-muted-foreground">不合规项：</span>
                          <div className="mt-2 space-y-2">
                            {selectedRecord.resultData.auditResult.nonComplianceItems.map(
                              (item, index) => (
                                <div
                                  key={index}
                                  className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm"
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="text-destructive font-medium">
                                      {index + 1}.
                                    </span>
                                    <div className="flex-1">
                                      <p className="font-medium text-destructive">
                                        {item.standard}
                                      </p>
                                      <p className="mt-1">{item.content}</p>
                                      <p className="mt-1 text-muted-foreground">
                                        建议：{item.suggestion}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => {
                      setDrawerOpen(false);
                      handleEdit(selectedRecord);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    重新编辑
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleExport(selectedRecord)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    导出
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                暂无详情信息
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default RecordsPage;
