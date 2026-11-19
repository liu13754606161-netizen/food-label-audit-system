import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  FileUp,
  FileText,
  Loader2,
  Check,
  RefreshCw,
  History,
  Eye,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  saveGenerate,
  getRecords,
  deleteRecord,
} from "@/api";
import {
  type FoodInfo,
  type FoodInfoItem,
  type ManufacturerInfo,
  type RecordItem,
} from "@shared/api.interface";
import { toast } from "sonner";
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  extractFromDocument,
} from '@/api';

const emptyFoodInfo: FoodInfo = {
  name: "",
  type: "",
  ingredients: "",
  nutrition: "",
  netContent: "",
  productionDate: "",
  shelfLife: "",
  storageCondition: "",
  standardCode: "",
  allergens: [],
  tips: "",
};

const emptyManufacturerInfo: ManufacturerInfo = {
  rawMaterialSupplier: {
    name: "",
    address: "",
    phone: "",
    license: "",
    origin: "",
  },
  delegator: {
    name: "",
    address: "",
    phone: "",
  },
  entrustedParty: {
    name: "",
    address: "",
    phone: "",
    license: "",
    origin: "",
  },
};

const toText = (...values: unknown[]): string => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const text = value
        .map((item) => toText(item))
        .filter(Boolean)
        .join("、");
      if (text.trim()) return text.trim();
      continue;
    }
    if (typeof value === "object") {
      const item = value as Record<string, unknown>;
      const nested = toText(
        item.name,
        item["名称"],
        item.value,
        item.text,
        item.label,
        item.company,
        item["公司名称"],
      );
      if (nested.trim()) return nested.trim();
      continue;
    }
    const text = String(value);
    if (text.trim()) return text.trim();
  }
  return "";
};

const normalizeSupplier = (raw: any = {}): ManufacturerInfo["rawMaterialSupplier"] => ({
  name: toText(raw.name, raw["名称"], raw.company, raw["公司名称"], raw),
  address: toText(raw.address, raw["地址"]),
  phone: toText(raw.phone, raw["电话"], raw["联系电话"]),
  license: toText(raw.license, raw["许可证编号"], raw["生产许可证编号"]),
  origin: toText(raw.origin, raw["产地"], raw["原产地"]),
});

const normalizeDelegator = (raw: any = {}): ManufacturerInfo["delegator"] => ({
  name: toText(raw.name, raw["名称"], raw.company, raw["公司名称"], raw),
  address: toText(raw.address, raw["地址"]),
  phone: toText(raw.phone, raw["电话"], raw["联系电话"]),
});

const normalizeEntrusted = (raw: any = {}): ManufacturerInfo["entrustedParty"] => ({
  name: toText(raw.name, raw["名称"], raw.company, raw["公司名称"], raw),
  address: toText(raw.address, raw["地址"]),
  phone: toText(raw.phone, raw["电话"], raw["联系电话"]),
  license: toText(raw.license, raw["许可证编号"], raw["生产许可证编号"]),
  origin: toText(raw.origin, raw["产地"], raw["原产地"]),
});

const normalizeManufacturerInfo = (raw: any = {}): ManufacturerInfo => ({
  rawMaterialSupplier: normalizeSupplier(raw.rawMaterialSupplier || raw.rawMaterialSupplierList || raw["原料生产商"] || raw["生产商"] || raw["制造商"] || {}),
  delegator: normalizeDelegator(raw.delegator || raw.delegatorList || raw["委托方"] || raw["经销商"] || raw["品牌商"] || {}),
  entrustedParty: normalizeEntrusted(raw.entrustedParty || raw.entrustedPartyList || raw["被委托方"] || raw["受委托方"] || raw["分装厂"] || raw["代工厂"] || {}),
});

const normalizeFoodInfo = (food: any = {}, index = 0): FoodInfoItem => ({
  name: toText(food.name, food.food_name, food["食品名称"], food["产品名称"]),
  type: toText(food.type, food.product_type, food["产品类型"], food["食品类型"]),
  ingredients: toText(food.ingredients, food.ingredients_list, food["配料表"], food["配料"]),
  nutrition: toText(food.nutrition, food.nutrition_facts, food["营养成分表"], food["营养成分"]),
  netContent: toText(food.netContent, food.net_content, food["净含量"]),
  productionDate: toText(food.productionDate, food.production_date, food["生产日期"]),
  shelfLife: toText(food.shelfLife, food.shelf_life, food["保质期"]),
  storageCondition: toText(food.storageCondition, food.storage_condition, food["贮存条件"], food["储存条件"]),
  standardCode: toText(food.standardCode, food.product_standard_number, food["产品标准号"], food["执行标准"]),
  allergens: Array.isArray(food.allergens)
    ? food.allergens.map((item: unknown) => toText(item)).filter(Boolean)
    : toText(food.allergens, food.allergen, food["过敏原"]).split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
  tips: toText(food.tips, food.warm_prompt, food["温馨提示"]),
  license: toText(food.license, food.production_license, food.production_license_number, food["生产许可证编号"]),
  title: toText(food.title, food.name, food.food_name, food["食品名称"]) || `食品${index + 1}`,
});

const hasManufacturerContent = (info?: ManufacturerInfo) =>
  Boolean(info && [
    info.rawMaterialSupplier?.name,
    info.rawMaterialSupplier?.address,
    info.rawMaterialSupplier?.phone,
    info.rawMaterialSupplier?.license,
    info.rawMaterialSupplier?.origin,
    info.delegator?.name,
    info.delegator?.address,
    info.delegator?.phone,
    info.entrustedParty?.name,
    info.entrustedParty?.address,
    info.entrustedParty?.phone,
    info.entrustedParty?.license,
    info.entrustedParty?.origin,
  ].some((value) => String(value || "").trim()));

const hasFoodContent = (food?: Partial<FoodInfo>) =>
  Boolean(food && [
    food.name,
    food.type,
    food.ingredients,
    food.nutrition,
    food.netContent,
    food.productionDate,
    food.shelfLife,
    food.storageCondition,
    food.standardCode,
    food.license,
    food.tips,
    Array.isArray(food.allergens) ? food.allergens.join("、") : food.allergens,
  ].some((value) => toText(value)));

const manufacturerSignature = (info?: ManufacturerInfo) =>
  [
    info?.rawMaterialSupplier?.name,
    info?.rawMaterialSupplier?.address,
    info?.rawMaterialSupplier?.phone,
    info?.rawMaterialSupplier?.license,
    info?.rawMaterialSupplier?.origin,
    info?.delegator?.name,
    info?.delegator?.address,
    info?.delegator?.phone,
    info?.entrustedParty?.name,
    info?.entrustedParty?.address,
    info?.entrustedParty?.phone,
    info?.entrustedParty?.license,
    info?.entrustedParty?.origin,
  ].map((value) => String(value || "").trim()).join("|");

const uniqueManufacturerList = (list: ManufacturerInfo[] = []) => {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (!hasManufacturerContent(item)) return false;
    const signature = manufacturerSignature(item);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

const normalizeEntityList = <T extends object>(
  raw: unknown,
  mapper: (item: any) => T,
): T[] => {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((item) => mapper(item))
    .filter((item) => Object.values(item).some((value) => String(value || "").trim()));
};

const uniqueJoin = (values: unknown[] = []) => {
  const result: string[] = [];
  values
    .flatMap((value) => toText(value).split(/[；;]+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      if (!result.includes(value)) result.push(value);
    });
  return result.join("；");
};

const mergeSupplierList = (
  list: ManufacturerInfo["rawMaterialSupplier"][] = [],
): ManufacturerInfo["rawMaterialSupplier"] => ({
  name: uniqueJoin(list.map((item) => item.name)),
  address: uniqueJoin(list.map((item) => item.address)),
  phone: uniqueJoin(list.map((item) => item.phone)),
  license: uniqueJoin(list.map((item) => item.license)),
  origin: uniqueJoin(list.map((item) => item.origin)),
});

const mergeDelegatorList = (
  list: ManufacturerInfo["delegator"][] = [],
): ManufacturerInfo["delegator"] => ({
  name: uniqueJoin(list.map((item) => item.name)),
  address: uniqueJoin(list.map((item) => item.address)),
  phone: uniqueJoin(list.map((item) => item.phone)),
});

const mergeEntrustedList = (
  list: ManufacturerInfo["entrustedParty"][] = [],
): ManufacturerInfo["entrustedParty"] => ({
  name: uniqueJoin(list.map((item) => item.name)),
  address: uniqueJoin(list.map((item) => item.address)),
  phone: uniqueJoin(list.map((item) => item.phone)),
  license: uniqueJoin(list.map((item) => item.license)),
  origin: uniqueJoin(list.map((item) => item.origin)),
});

const looksLikeEntrusted = (item?: ManufacturerInfo["rawMaterialSupplier"]) => {
  const text = `${item?.name || ""}${item?.address || ""}`;
  return /被委托方|受委托方|分装|代工/.test(text);
};

const looksLikeSupplier = (item?: ManufacturerInfo["entrustedParty"]) => {
  const text = `${item?.name || ""}${item?.address || ""}`;
  return /原料|生产商|制造商|原产商/.test(text) && !/被委托方|受委托方/.test(text);
};

const GeneratePage: React.FC = () => {
  const navigate = useNavigate();
  const [recordId, setRecordId] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState<boolean>(false);

  const [foodInfo, setFoodInfo] = useState<FoodInfo>(emptyFoodInfo);
  const [isMultiFood, setIsMultiFood] = useState(false);
  const [foodList, setFoodList] = useState<FoodInfoItem[]>([]);
  const [currentFoodIndex, setCurrentFoodIndex] = useState(0);
  const [manufacturerList, setManufacturerList] = useState<ManufacturerInfo[]>([]);
  const [currentManufacturerIndex, setCurrentManufacturerIndex] = useState(0);
  const [rawMaterialSupplierList, setRawMaterialSupplierList] = useState<ManufacturerInfo['rawMaterialSupplier'][]>([]);
  const [currentRawMaterialSupplierIndex, setCurrentRawMaterialSupplierIndex] = useState(0);
  const [delegatorList, setDelegatorList] = useState<ManufacturerInfo['delegator'][]>([]);
  const [currentDelegatorIndex, setCurrentDelegatorIndex] = useState(0);
  const [entrustedPartyList, setEntrustedPartyList] = useState<ManufacturerInfo['entrustedParty'][]>([]);
  const [currentEntrustedPartyIndex, setCurrentEntrustedPartyIndex] = useState(0);
  const [manufacturerInfo, setManufacturerInfo] =
    useState<ManufacturerInfo>(emptyManufacturerInfo);
  const [extractedText, setExtractedText] = useState<string>("");
  const [historyRecords, setHistoryRecords] = useState<RecordItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // localStorage key for current draft state
  const STORAGE_KEY = "generate_draft_state";
  const STORAGE_HANDOFF_KEY = "generate_draft_handoff";

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const shouldRestore = localStorage.getItem(STORAGE_HANDOFF_KEY) === "1";
      if (!shouldRestore) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_HANDOFF_KEY);
        return;
      }
      localStorage.removeItem(STORAGE_HANDOFF_KEY);
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          recordId?: string;
          fileName?: string;
          foodInfo?: FoodInfo;
          isMultiFood?: boolean;
          foodList?: FoodInfoItem[];
          currentFoodIndex?: number;
          manufacturerList?: ManufacturerInfo[];
          currentManufacturerIndex?: number;
          manufacturerInfo?: ManufacturerInfo;
          rawMaterialSupplierList?: ManufacturerInfo['rawMaterialSupplier'][];
          currentRawMaterialSupplierIndex?: number;
          delegatorList?: ManufacturerInfo['delegator'][];
          currentDelegatorIndex?: number;
          entrustedPartyList?: ManufacturerInfo['entrustedParty'][];
          currentEntrustedPartyIndex?: number;
        };
        if (parsed.recordId) setRecordId(parsed.recordId);
        if (parsed.fileName) setFileName(parsed.fileName);
        if (parsed.foodInfo) setFoodInfo(normalizeFoodInfo(parsed.foodInfo));
        if (parsed.isMultiFood) setIsMultiFood(parsed.isMultiFood);
        if (parsed.foodList) setFoodList(parsed.foodList.map((food, index) => normalizeFoodInfo(food, index)));
        if (parsed.currentFoodIndex != null) setCurrentFoodIndex(parsed.currentFoodIndex);
        if (parsed.manufacturerList) setManufacturerList(uniqueManufacturerList(parsed.manufacturerList.map(normalizeManufacturerInfo)));
        if (parsed.currentManufacturerIndex != null) setCurrentManufacturerIndex(parsed.currentManufacturerIndex);
        if (parsed.rawMaterialSupplierList) setRawMaterialSupplierList(parsed.rawMaterialSupplierList.map(normalizeSupplier));
        if (parsed.currentRawMaterialSupplierIndex != null) setCurrentRawMaterialSupplierIndex(parsed.currentRawMaterialSupplierIndex);
        if (parsed.delegatorList) setDelegatorList(parsed.delegatorList.map(normalizeDelegator));
        if (parsed.currentDelegatorIndex != null) setCurrentDelegatorIndex(parsed.currentDelegatorIndex);
        if (parsed.entrustedPartyList) setEntrustedPartyList(parsed.entrustedPartyList.map(normalizeEntrusted));
        if (parsed.currentEntrustedPartyIndex != null) setCurrentEntrustedPartyIndex(parsed.currentEntrustedPartyIndex);
        if (parsed.manufacturerInfo) setManufacturerInfo(normalizeManufacturerInfo(parsed.manufacturerInfo));
      }
    } catch (error) {
      logger.error("Failed to restore draft state:", {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        localStorage.removeItem(STORAGE_HANDOFF_KEY);
      } catch {
        // noop
      }
    }
  }, []);

  // Save current state to localStorage
  const saveDraftState = useCallback(() => {
    try {
      if (recordId) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          recordId,
          fileName,
          foodInfo,
          isMultiFood,
          foodList,
          currentFoodIndex,
          manufacturerList,
          currentManufacturerIndex,
          rawMaterialSupplierList,
          currentRawMaterialSupplierIndex,
          delegatorList,
          currentDelegatorIndex,
          entrustedPartyList,
          currentEntrustedPartyIndex,
          manufacturerInfo,
        }));
      }
    } catch (error) {
      logger.error("Failed to save draft state:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [recordId, fileName, foodInfo, isMultiFood, foodList, currentFoodIndex, manufacturerList, currentManufacturerIndex, rawMaterialSupplierList, currentRawMaterialSupplierIndex, delegatorList, currentDelegatorIndex, entrustedPartyList, currentEntrustedPartyIndex, manufacturerInfo]);

  // Clear saved draft state (called on re-upload)
  const clearDraftState = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_HANDOFF_KEY);
    } catch (error) {
      logger.error("Failed to clear draft state:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const resp = await getRecords({ type: "generate", pageSize: 10 });
        setHistoryRecords(resp.items);
      } catch (error) {
        logger.error("Load history error:", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoadingHistory(false);
      }
    };
    loadHistory();
  }, []);

  // 查看历史记录 - 恢复当时的所有信息
  const handleViewHistory = useCallback((record: RecordItem) => {
    if (record.rawData?.foodInfo) {
      setFoodInfo(normalizeFoodInfo(record.rawData.foodInfo));
    }
    if (record.rawData?.isMultiFood) {
      setIsMultiFood(record.rawData.isMultiFood);
    }
    if (record.rawData?.foodList) {
      setFoodList(record.rawData.foodList.map((food, index) => normalizeFoodInfo(food, index)));
    }
    if (record.rawData?.manufacturerInfo) {
      setManufacturerInfo(normalizeManufacturerInfo(record.rawData.manufacturerInfo));
    }
    if (record.rawData?.manufacturerList) {
      setManufacturerList(uniqueManufacturerList(record.rawData.manufacturerList.map(normalizeManufacturerInfo)));
    }
    if (record.rawData?.currentManufacturerIndex != null) {
      setCurrentManufacturerIndex(record.rawData.currentManufacturerIndex);
    }
    // 使用类型断言访问扩展字段
    const rawData = record.rawData as RecordItem['rawData'] & {
      rawMaterialSupplierList?: ManufacturerInfo['rawMaterialSupplier'][];
      currentRawMaterialSupplierIndex?: number;
      delegatorList?: ManufacturerInfo['delegator'][];
      currentDelegatorIndex?: number;
      entrustedPartyList?: ManufacturerInfo['entrustedParty'][];
      currentEntrustedPartyIndex?: number;
    };
    if (rawData?.rawMaterialSupplierList) {
      setRawMaterialSupplierList(rawData.rawMaterialSupplierList.map(normalizeSupplier));
    }
    if (rawData?.currentRawMaterialSupplierIndex != null) {
      setCurrentRawMaterialSupplierIndex(rawData.currentRawMaterialSupplierIndex);
    }
    if (rawData?.delegatorList) {
      setDelegatorList(rawData.delegatorList.map(normalizeDelegator));
    }
    if (rawData?.currentDelegatorIndex != null) {
      setCurrentDelegatorIndex(rawData.currentDelegatorIndex);
    }
    if (rawData?.entrustedPartyList) {
      setEntrustedPartyList(rawData.entrustedPartyList.map(normalizeEntrusted));
    }
    if (rawData?.currentEntrustedPartyIndex != null) {
      setCurrentEntrustedPartyIndex(rawData.currentEntrustedPartyIndex);
    }
    setRecordId(record.id);
    setFileName(record.fileName);
    toast.success("已恢复历史记录");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // 删除历史记录
  const handleDeleteHistory = useCallback(async (id: string) => {
    try {
      await deleteRecord(id);
      setHistoryRecords((prev) => prev.filter((r) => r.id !== id));
      toast.success("已删除记录");
    } catch (error) {
      toast.error("删除失败，请重试");
      logger.error("Delete history error:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  // Current food being edited
  const currentFood: FoodInfo = isMultiFood
    ? (foodList[currentFoodIndex] ?? emptyFoodInfo)
    : foodInfo;

  const currentManufacturer: ManufacturerInfo = isMultiFood && manufacturerList.length > 0
    ? {
        ...manufacturerList[currentManufacturerIndex],
        rawMaterialSupplier: rawMaterialSupplierList.length > 0
          ? (rawMaterialSupplierList[currentRawMaterialSupplierIndex] ?? emptyManufacturerInfo.rawMaterialSupplier)
          : manufacturerList[currentManufacturerIndex]?.rawMaterialSupplier ?? emptyManufacturerInfo.rawMaterialSupplier,
        delegator: delegatorList.length > 0
          ? (delegatorList[currentDelegatorIndex] ?? emptyManufacturerInfo.delegator)
          : manufacturerList[currentManufacturerIndex]?.delegator ?? emptyManufacturerInfo.delegator,
        entrustedParty: entrustedPartyList.length > 0
          ? (entrustedPartyList[currentEntrustedPartyIndex] ?? emptyManufacturerInfo.entrustedParty)
          : manufacturerList[currentManufacturerIndex]?.entrustedParty ?? emptyManufacturerInfo.entrustedParty,
      }
    : {
        ...manufacturerInfo,
        rawMaterialSupplier: rawMaterialSupplierList.length > 0
          ? (rawMaterialSupplierList[currentRawMaterialSupplierIndex] ?? emptyManufacturerInfo.rawMaterialSupplier)
          : manufacturerInfo.rawMaterialSupplier,
        delegator: delegatorList.length > 0
          ? (delegatorList[currentDelegatorIndex] ?? emptyManufacturerInfo.delegator)
          : manufacturerInfo.delegator,
        entrustedParty: entrustedPartyList.length > 0
          ? (entrustedPartyList[currentEntrustedPartyIndex] ?? emptyManufacturerInfo.entrustedParty)
          : manufacturerInfo.entrustedParty,
      };

  const buildCurrentPayload = useCallback(() => {
    const normalizedFoods = isMultiFood
      ? foodList.map((food, index) => normalizeFoodInfo(food, index)).filter((food) => [
          food.name,
          food.type,
          food.ingredients,
          food.nutrition,
          food.netContent,
          food.shelfLife,
          food.storageCondition,
          food.standardCode,
          food.license,
        ].some((value) => toText(value)))
      : [normalizeFoodInfo(currentFood)].filter((food) => [
          food.name,
          food.type,
          food.ingredients,
          food.nutrition,
          food.netContent,
          food.shelfLife,
          food.storageCondition,
          food.standardCode,
          food.license,
        ].some((value) => toText(value)));
    const normalizedManufacturer = normalizeManufacturerInfo(currentManufacturer);
    const normalizedManufacturers = uniqueManufacturerList(
      manufacturerList.length
        ? manufacturerList.map(normalizeManufacturerInfo)
        : [normalizedManufacturer],
    );
    const finalManufacturerList = normalizedManufacturers.length
      ? normalizedManufacturers
      : hasManufacturerContent(normalizedManufacturer)
        ? [normalizedManufacturer]
        : [];
    return {
      foodInfo: normalizedFoods[0] || emptyFoodInfo,
      foodList: normalizedFoods,
      manufacturerInfo: finalManufacturerList[0] || normalizedManufacturer,
      manufacturerList: finalManufacturerList,
      isMultiFood: normalizedFoods.length > 1,
    };
  }, [isMultiFood, foodList, currentFood, currentManufacturer, manufacturerList]);

  const handleVerify = async () => {
    const payload = buildCurrentPayload();
    if (!payload.foodList.length) {
      toast.error("请先提取或填写食品信息");
      return;
    }
    if (!payload.manufacturerList.length) {
      toast.error("请先提取或填写厂商信息");
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const defaultFilename = fileName ? `${fileName}_${today}` : `标签信息_${today}`;
    try {
      const saveResp = await saveGenerate({
        recordId: recordId || '',
        manufacturerInfo: payload.manufacturerInfo,
        foodInfo: payload.foodInfo,
        isMultiFood: payload.isMultiFood,
        foodList: payload.foodList,
        manufacturerList: payload.manufacturerList,
        ...(rawMaterialSupplierList.length > 0 ? { rawMaterialSupplierList } : {}),
        ...(delegatorList.length > 0 ? { delegatorList } : {}),
        ...(entrustedPartyList.length > 0 ? { entrustedPartyList } : {}),
      });
      if (!recordId) setRecordId(saveResp.recordId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        recordId: saveResp.recordId,
        fileName,
        foodInfo: payload.foodInfo,
        foodList: payload.foodList,
        isMultiFood: payload.isMultiFood,
        currentFoodIndex,
        manufacturerInfo: payload.manufacturerInfo,
        manufacturerList: payload.manufacturerList,
        currentManufacturerIndex,
        rawMaterialSupplierList,
        currentRawMaterialSupplierIndex,
        delegatorList,
        currentDelegatorIndex,
        entrustedPartyList,
        currentEntrustedPartyIndex,
      }));
    } catch (error) {
      toast.error("核对前保存失败，请重试");
      logger.error("Verify save error:", error);
      return;
    }
    navigate("/verify", {
      state: {
        foodInfo: payload.foodInfo,
        foodList: payload.foodList,
        manufacturerInfo: payload.manufacturerInfo,
        manufacturerList: payload.manufacturerList,
        filename: defaultFilename,
      },
    });
  };

  const handleFoodInfoChange = (
    field: keyof FoodInfo,
    value: string | string[]
  ) => {
    if (isMultiFood) {
      setFoodList((prev) =>
        prev.map((item, idx) =>
          idx === currentFoodIndex ? { ...item, [field]: value } : item
        )
      );
    } else {
      setFoodInfo((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleDelegatorChange = (
    field: keyof ManufacturerInfo["delegator"],
    value: string
  ) => {
    if (delegatorList.length > 0) {
      setDelegatorList((prev) =>
        prev.map((item, idx) =>
          idx === currentDelegatorIndex
            ? { ...item, [field]: value }
            : item
        )
      );
    } else if (isMultiFood && manufacturerList.length > 0) {
      setManufacturerList((prev) =>
        prev.map((item, idx) =>
          idx === currentManufacturerIndex
            ? { ...item, delegator: { ...item.delegator, [field]: value } }
            : item
        )
      );
    } else {
      setManufacturerInfo((prev) => ({
        ...prev,
        delegator: { ...prev.delegator, [field]: value },
      }));
    }
  };

  const handleEntrustedPartyChange = (
    field: keyof ManufacturerInfo["entrustedParty"],
    value: string
  ) => {
    if (entrustedPartyList.length > 0) {
      setEntrustedPartyList((prev) =>
        prev.map((item, idx) =>
          idx === currentEntrustedPartyIndex
            ? { ...item, [field]: value }
            : item
        )
      );
    } else if (isMultiFood && manufacturerList.length > 0) {
      setManufacturerList((prev) =>
        prev.map((item, idx) =>
          idx === currentManufacturerIndex
            ? { ...item, entrustedParty: { ...item.entrustedParty, [field]: value } }
            : item
        )
      );
    } else {
      setManufacturerInfo((prev) => ({
        ...prev,
        entrustedParty: { ...prev.entrustedParty, [field]: value },
      }));
    }
  };

  const handleRawMaterialSupplierChange = (
    field: keyof ManufacturerInfo["rawMaterialSupplier"],
    value: string
  ) => {
    if (rawMaterialSupplierList.length > 0) {
      setRawMaterialSupplierList((prev) =>
        prev.map((item, idx) =>
          idx === currentRawMaterialSupplierIndex
            ? { ...item, [field]: value }
            : item
        )
      );
    } else if (isMultiFood && manufacturerList.length > 0) {
      setManufacturerList((prev) =>
        prev.map((item, idx) =>
          idx === currentManufacturerIndex
            ? { ...item, rawMaterialSupplier: { ...item.rawMaterialSupplier, [field]: value } }
            : item
        )
      );
    } else {
      setManufacturerInfo((prev) => ({
        ...prev,
        rawMaterialSupplier: { ...prev.rawMaterialSupplier, [field]: value },
      }));
    }
  };

  const handleExtract = useCallback(async (file: File) => {
    clearDraftState();
    setIsExtracting(true);
    setFileName(file.name);
    
    // 重置所有列表状态，确保之前的内容不会影响新的识别
    setFoodList([]);
    setManufacturerList([]);
    setRawMaterialSupplierList([]);
    setDelegatorList([]);
    setEntrustedPartyList([]);
    setCurrentFoodIndex(0);
    setCurrentManufacturerIndex(0);
    setCurrentRawMaterialSupplierIndex(0);
    setCurrentDelegatorIndex(0);
    setCurrentEntrustedPartyIndex(0);
    
    try {
      logger.info('[Extract] Starting document extraction...');
      const extractedData = await extractFromDocument(file);
      logger.info('[Extract] Document extraction completed', { extractedData });

      // 检查是否是多实体返回（包含 foodList 数组）
      if (extractedData.foodList && extractedData.foodList.length > 0) {
        const extractedIsMultiFood = extractedData.foodList.length > 1;
        setIsMultiFood(extractedIsMultiFood);
        
        // 1. 批量覆盖食品列表 (开启终极兼容模式：兼容驼峰、下划线、甚至中文 Key)
        const mappedFoodList: FoodInfoItem[] = extractedData.foodList.map((food: any, index: number) => normalizeFoodInfo(food, index));

        setFoodList(mappedFoodList);
        setCurrentFoodIndex(0);

        // 2. 处理厂商信息：优先使用后端清洗后的 manufacturerList，再兼容旧版数组字段
        const rawMfg: any = extractedData.manufacturerInfo || {};
        const backendManufacturerList = uniqueManufacturerList(extractedData.manufacturerList || []);
        
        const rawSupplier = backendManufacturerList.length
          ? backendManufacturerList.map((item) => item.rawMaterialSupplier)
          : rawMfg.rawMaterialSupplier || rawMfg.rawMaterialSupplierList || rawMfg['原料生产商'] || rawMfg['生产商'] || rawMfg['制造商'];
        let supplierList = normalizeEntityList<ManufacturerInfo['rawMaterialSupplier']>(rawSupplier, (s) => ({
          ...normalizeSupplier(s),
        }));

        const rawDelegator = backendManufacturerList.length
          ? backendManufacturerList.map((item) => item.delegator)
          : rawMfg.delegator || rawMfg.delegatorList || rawMfg['委托方'] || rawMfg['经销商'] || rawMfg['品牌商'];
        const delegatorListData = normalizeEntityList<ManufacturerInfo['delegator']>(rawDelegator, (d) => ({
          ...normalizeDelegator(d),
        }));

        const rawEntrusted = backendManufacturerList.length
          ? backendManufacturerList.map((item) => item.entrustedParty)
          : rawMfg.entrustedParty || rawMfg.entrustedPartyList || rawMfg['被委托方'] || rawMfg['受委托方'] || rawMfg['分装厂'] || rawMfg['代工厂'];
        let entrustedListData = normalizeEntityList<ManufacturerInfo['entrustedParty']>(rawEntrusted, (e) => ({
          ...normalizeEntrusted(e),
        }));

        if (looksLikeEntrusted(supplierList[0]) && !entrustedListData.length) {
          entrustedListData = supplierList.map((item) => ({
            name: item.name,
            address: item.address,
            phone: item.phone || '',
            license: item.license || '',
            origin: item.origin || '',
          }));
          supplierList = [];
        }
        if (looksLikeSupplier(entrustedListData[0]) && !supplierList.length) {
          supplierList = entrustedListData.map((item) => ({
            name: item.name,
            address: item.address,
            phone: item.phone || '',
            license: item.license,
            origin: item.origin,
          }));
          entrustedListData = [];
        }

        setRawMaterialSupplierList(supplierList);
        setCurrentRawMaterialSupplierIndex(0);
        setDelegatorList(delegatorListData);
        setCurrentDelegatorIndex(0);
        setEntrustedPartyList(entrustedListData);
        setCurrentEntrustedPartyIndex(0);

        // 构建统一的 manufacturerInfo，同类多主体用分号合并，避免只显示第一个生产商
        const extractedManufacturerInfo: ManufacturerInfo = {
          rawMaterialSupplier: mergeSupplierList(supplierList),
          delegator: mergeDelegatorList(delegatorListData),
          entrustedParty: mergeEntrustedList(entrustedListData),
        };

        // 批量处理厂商信息：只保留文档里真实出现的厂商，避免空厂商被导出成“厂商2”
        const manufacturerListArray = uniqueManufacturerList([extractedManufacturerInfo]);
        setManufacturerList(manufacturerListArray);
        setCurrentManufacturerIndex(0);
        setManufacturerInfo(extractedManufacturerInfo);

        // 4. 保存到后端（完整保存多食品数组和状态）
        const saveResponse = await saveGenerate({
          recordId: '',
          manufacturerInfo: extractedManufacturerInfo,
          foodInfo: mappedFoodList[0], // 为了兼容单实体的旧逻辑保留
          isMultiFood: extractedIsMultiFood,
          foodList: mappedFoodList,    // 把整个数组传给后端！
          manufacturerList: manufacturerListArray, // 把厂商数组也传给后端！
          rawMaterialSupplierList: supplierList,
          delegatorList: delegatorListData,
          entrustedPartyList: entrustedListData,
        });
        setRecordId(saveResponse.recordId);

        toast.success(`文档提取成功，共识别到 ${mappedFoodList.length} 个食品`);
      } else if (extractedData.foodInfo) {
        // 兼容旧版单实体返回格式
        const emptyManufacturerInfo: ManufacturerInfo = {
          rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
          delegator: { name: '', address: '', phone: '' },
          entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
        };
        
        // 根据当前模式处理食品信息
        if (isMultiFood) {
          // 多食品模式：添加到列表
          const extractedFood = normalizeFoodInfo(extractedData.foodInfo, foodList.length);
          const newFoodItem: FoodInfoItem = {
            ...extractedFood,
            title: extractedFood.name || `食品${foodList.length + 1}`,
          };
          const newFoodList = [...foodList, newFoodItem];
          setFoodList(newFoodList);
          setCurrentFoodIndex(newFoodList.length - 1);
          
          // 多食品模式下也添加对应的厂商信息
          const newManufacturerList = uniqueManufacturerList([...manufacturerList, emptyManufacturerInfo]);
          setManufacturerList(newManufacturerList);
          setCurrentManufacturerIndex(newManufacturerList.length - 1);
          
          // 保存到后端
          const saveResponse = await saveGenerate({
            recordId: recordId || '',
            manufacturerInfo: emptyManufacturerInfo,
            foodInfo: extractedFood,
          });
          if (!recordId) {
            setRecordId(saveResponse.recordId);
          }
          toast.success(`文档提取成功，已添加食品 ${newFoodList.length}`);
        } else {
          // 单食品模式：替换当前食品信息
          setFoodList([]);
          const saveResponse = await saveGenerate({
            recordId: '',
            manufacturerInfo: emptyManufacturerInfo,
            foodInfo: normalizeFoodInfo(extractedData.foodInfo),
          });
          setRecordId(saveResponse.recordId);
          setFoodInfo(normalizeFoodInfo(extractedData.foodInfo));
          setManufacturerInfo(emptyManufacturerInfo);
          toast.success("文档提取成功");
        }
      } else {
        throw new Error('无法识别的文档结构，未找到食品信息');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      let displayMsg = "文档提取失败";
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        displayMsg = "提取超时，文件可能过大，请尝试较小的文件";
      } else if (errorMsg.includes('too large')) {
        displayMsg = "文件过大，请减小文件后重试";
      } else if (errorMsg.includes('empty') || errorMsg.includes('空')) {
        displayMsg = "文档内容为空或无法解析";
      } else {
        displayMsg = `文档提取失败: ${errorMsg}`;
      }
      toast.error(displayMsg);
      logger.error('Extract error:', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsExtracting(false);
    }
  }, [isMultiFood]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        handleExtract(acceptedFiles[0]);
      }
    },
    [handleExtract]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
    },
    multiple: false,
    disabled: isExtracting,
  });

  const handleReextract = useCallback(async () => {
    if (!extractedText) {
      toast.error("没有可重新提取的文本，请先上传文档");
      return;
    }
    clearDraftState();
    setIsExtracting(true);
    try {
      toast.info('请重新上传文档以重新提取信息');
    } catch (error) {
      toast.error("重新提取失败，请重试");
      logger.error('Reextract error:', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsExtracting(false);
    }
  }, [extractedText, recordId, foodInfo, manufacturerInfo, isMultiFood]);

  const handleClearAll = useCallback(() => {
    clearDraftState();
    setRecordId("");
    setFileName("");
    setIsExtracting(false);
    setExtractedText("");
    setFoodInfo(emptyFoodInfo);
    setIsMultiFood(false);
    setFoodList([]);
    setCurrentFoodIndex(0);
    setManufacturerList([]);
    setCurrentManufacturerIndex(0);
    setRawMaterialSupplierList([]);
    setCurrentRawMaterialSupplierIndex(0);
    setDelegatorList([]);
    setCurrentDelegatorIndex(0);
    setEntrustedPartyList([]);
    setCurrentEntrustedPartyIndex(0);
    setManufacturerInfo(emptyManufacturerInfo);
    toast.success("已清空当前内容");
  }, [clearDraftState]);

  const verifyUploadCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          开始核对
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-accent"
              : "border-border hover:border-primary"
          } ${isExtracting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input {...getInputProps()} />
          {isExtracting ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">正在提取文档信息...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <FileUp className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">
                {isDragActive ? "松开以上传文件" : "拖拽PDF/Word文档或点击上传"}
              </p>
              <p className="text-sm text-muted-foreground">支持 .pdf、.doc、.docx 格式</p>
              {fileName && (
                <div className="flex items-center gap-2 mt-2 text-sm text-primary">
                  <Check className="h-4 w-4" />
                  {fileName}
                </div>
              )}
            </div>
          )}
        </div>

        {extractedText && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleReextract}
            disabled={isExtracting}
          >
            {isExtracting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            重新提取（基于原文本）
          </Button>
        )}

        {(hasFoodContent(currentFood) || foodList.length > 0 || hasManufacturerContent(currentManufacturer)) && (
          <Button
            variant="default"
            className="w-full"
            onClick={handleVerify}
          >
            <Eye className="mr-2 h-4 w-4" />
            核对
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className={`container mx-auto max-w-[1400px] p-6 space-y-6 transition-colors duration-200 ${isMultiFood ? 'bg-slate-200' : 'bg-background'}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">标签内容展示</h1>
          <p className="text-sm text-muted-foreground mt-1">
            完成食品信息提取、厂商信息填写和标签导出全流程
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* 食品信息和厂商信息 - 两列布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 食品信息区 - 左列 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                食品信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isMultiFood && foodList.length > 0 && (
                <Tabs
                  value={String(currentFoodIndex)}
                  onValueChange={(v) => {
                    setCurrentFoodIndex(Number(v));
                    // 加上这一句：让厂商信息的标签和食品的标签同步切换
                    setCurrentManufacturerIndex(Number(v));
                  }}
                >
                  <TabsList className="w-full justify-start overflow-x-auto flex-nowrap h-auto p-1">
                    {foodList.map((item, idx) => (
                      <TabsTrigger
                        key={idx}
                        value={String(idx)}
                        className="text-xs px-3 py-1.5 whitespace-nowrap shrink-0"
                      >
                        {item.title || `食品${idx + 1}`}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">食品名称/产品名称</Label>
                  <Input
                    id="name"
                    value={currentFood.name}
                    onChange={(e) =>
                      handleFoodInfoChange("name", e.target.value)
                    }
                    placeholder="请输入食品名称或产品名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">产品类型</Label>
                  <Input
                    id="type"
                    value={currentFood.type}
                    onChange={(e) =>
                      handleFoodInfoChange("type", e.target.value)
                    }
                    placeholder="请输入产品类型"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ingredients">配料表</Label>
                <Textarea
                  id="ingredients"
                  value={currentFood.ingredients}
                  onChange={(e) =>
                    handleFoodInfoChange("ingredients", e.target.value)
                  }
                  placeholder="请输入配料表"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="netContent">净含量</Label>
                  <Input
                    id="netContent"
                    value={currentFood.netContent}
                    onChange={(e) =>
                      handleFoodInfoChange("netContent", e.target.value)
                    }
                    placeholder="如：500g"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelfLife">保质期</Label>
                  <Input
                    id="shelfLife"
                    value={currentFood.shelfLife}
                    onChange={(e) =>
                      handleFoodInfoChange("shelfLife", e.target.value)
                    }
                    placeholder="如：12个月"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="storageCondition">贮存条件</Label>
                <Input
                  id="storageCondition"
                  value={currentFood.storageCondition}
                  onChange={(e) =>
                    handleFoodInfoChange("storageCondition", e.target.value)
                  }
                  placeholder="如：置于阴凉干燥处"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="allergens">过敏原警示语</Label>
                <Input
                  id="allergens"
                  value={(currentFood.allergens || []).join("、")}
                  onChange={(e) => {
                    const list = e.target.value
                      ? e.target.value.split(/[、,，]/).filter(Boolean)
                      : [];
                    handleFoodInfoChange("allergens", list);
                  }}
                  placeholder="请输入完整的过敏原警示语，如：本产品可能含有花生、坚果、麸质成分"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="standardCode">产品标准号</Label>
                <Input
                  id="standardCode"
                  value={currentFood.standardCode}
                  onChange={(e) =>
                    handleFoodInfoChange("standardCode", e.target.value)
                  }
                  placeholder="如：GB/T xxx"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tips">温馨提示</Label>
                <Textarea
                  id="tips"
                  value={currentFood.tips || ""}
                  onChange={(e) =>
                    handleFoodInfoChange("tips", e.target.value)
                  }
                  placeholder="请输入温馨提示或注意事项"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

        {/* 厂商信息 - 右列 */}
        <div className="space-y-6">

            {/* 原料生产商（浅红色背景） */}
            <Card className="bg-red-50 border-red-200">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    原料生产商（生产商）
                  </div>
                  {rawMaterialSupplierList.length > 1 && (
                    <Tabs
                      value={String(currentRawMaterialSupplierIndex)}
                      onValueChange={(v) => setCurrentRawMaterialSupplierIndex(Number(v))}
                    >
                      <TabsList className="h-auto p-1">
                        {rawMaterialSupplierList.map((_, idx) => (
                          <TabsTrigger
                            key={idx}
                            value={String(idx)}
                            className="text-xs px-3 py-1.5 whitespace-nowrap"
                          >
                            生产商{idx + 1}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supplierName">名称</Label>
                  <Input
                    id="supplierName"
                    value={currentManufacturer.rawMaterialSupplier.name}
                    onChange={(e) =>
                      handleRawMaterialSupplierChange("name", e.target.value)
                    }
                    placeholder="原料生产商名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplierAddress">地址</Label>
                  <Input
                    id="supplierAddress"
                    value={currentManufacturer.rawMaterialSupplier.address}
                    onChange={(e) =>
                      handleRawMaterialSupplierChange("address", e.target.value)
                    }
                    placeholder="原料生产商地址"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="supplierLicense">许可证编号</Label>
                    <Input
                      id="supplierLicense"
                      value={currentManufacturer.rawMaterialSupplier.license}
                      onChange={(e) =>
                        handleRawMaterialSupplierChange("license", e.target.value)
                      }
                      placeholder="生产许可证编号"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplierOrigin">产地</Label>
                    <Input
                      id="supplierOrigin"
                      value={currentManufacturer.rawMaterialSupplier.origin}
                      onChange={(e) =>
                        handleRawMaterialSupplierChange("origin", e.target.value)
                      }
                      placeholder="如：北京市"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplierPhone">联系电话</Label>
                  <Input
                    id="supplierPhone"
                    value={currentManufacturer.rawMaterialSupplier.phone}
                    onChange={(e) =>
                      handleRawMaterialSupplierChange("phone", e.target.value)
                    }
                    placeholder="联系电话（选填）"
                  />
                </div>
              </CardContent>
            </Card>

            {/* 委托方（浅蓝色背景） */}
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    委托方
                  </div>
                  {delegatorList.length > 1 && (
                    <Tabs
                      value={String(currentDelegatorIndex)}
                      onValueChange={(v) => setCurrentDelegatorIndex(Number(v))}
                    >
                      <TabsList className="h-auto p-1">
                        {delegatorList.map((_, idx) => (
                          <TabsTrigger
                            key={idx}
                            value={String(idx)}
                            className="text-xs px-3 py-1.5 whitespace-nowrap"
                          >
                            委托方{idx + 1}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="delegatorName">名称</Label>
                  <Input
                    id="delegatorName"
                    value={delegatorList.length > 0 
                      ? (delegatorList[currentDelegatorIndex]?.name ?? '') 
                      : currentManufacturer.delegator.name}
                    onChange={(e) =>
                      handleDelegatorChange("name", e.target.value)
                    }
                    placeholder="委托方名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delegatorAddress">地址</Label>
                  <Input
                    id="delegatorAddress"
                    value={delegatorList.length > 0 
                      ? (delegatorList[currentDelegatorIndex]?.address ?? '') 
                      : currentManufacturer.delegator.address}
                    onChange={(e) =>
                      handleDelegatorChange("address", e.target.value)
                    }
                    placeholder="委托方地址"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delegatorPhone">联系电话</Label>
                  <Input
                    id="delegatorPhone"
                    value={delegatorList.length > 0 
                      ? (delegatorList[currentDelegatorIndex]?.phone ?? '') 
                      : currentManufacturer.delegator.phone}
                    onChange={(e) =>
                      handleDelegatorChange("phone", e.target.value)
                    }
                    placeholder="委托方联系电话"
                  />
                </div>
              </CardContent>
            </Card>

            {/* 被委托方（浅黄色背景） */}
            <Card className="bg-yellow-50 border-yellow-200">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    被委托方
                  </div>
                  {entrustedPartyList.length > 1 && (
                    <Tabs
                      value={String(currentEntrustedPartyIndex)}
                      onValueChange={(v) => setCurrentEntrustedPartyIndex(Number(v))}
                    >
                      <TabsList className="h-auto p-1">
                        {entrustedPartyList.map((_, idx) => (
                          <TabsTrigger
                            key={idx}
                            value={String(idx)}
                            className="text-xs px-3 py-1.5 whitespace-nowrap"
                          >
                            被委托方{idx + 1}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="entrustedName">名称</Label>
                  <Input
                    id="entrustedName"
                    value={entrustedPartyList.length > 0 
                      ? (entrustedPartyList[currentEntrustedPartyIndex]?.name ?? '') 
                      : currentManufacturer.entrustedParty.name}
                    onChange={(e) =>
                      handleEntrustedPartyChange("name", e.target.value)
                    }
                    placeholder="被委托方名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="entrustedAddress">地址</Label>
                  <Input
                    id="entrustedAddress"
                    value={entrustedPartyList.length > 0 
                      ? (entrustedPartyList[currentEntrustedPartyIndex]?.address ?? '') 
                      : currentManufacturer.entrustedParty.address}
                    onChange={(e) =>
                      handleEntrustedPartyChange("address", e.target.value)
                    }
                    placeholder="被委托方地址"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="entrustedLicense">许可证编号</Label>
                    <Input
                      id="entrustedLicense"
                      value={entrustedPartyList.length > 0 
                        ? (entrustedPartyList[currentEntrustedPartyIndex]?.license ?? '') 
                        : currentManufacturer.entrustedParty.license}
                      onChange={(e) =>
                        handleEntrustedPartyChange("license", e.target.value)
                      }
                      placeholder="生产许可证编号"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="entrustedOrigin">产地</Label>
                    <Input
                      id="entrustedOrigin"
                      value={entrustedPartyList.length > 0 
                        ? (entrustedPartyList[currentEntrustedPartyIndex]?.origin ?? '') 
                        : currentManufacturer.entrustedParty.origin}
                      onChange={(e) =>
                        handleEntrustedPartyChange("origin", e.target.value)
                      }
                      placeholder="如：北京市"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="entrustedPhone">联系电话</Label>
                  <Input
                    id="entrustedPhone"
                    value={entrustedPartyList.length > 0 
                      ? (entrustedPartyList[currentEntrustedPartyIndex]?.phone ?? '') 
                      : currentManufacturer.entrustedParty.phone}
                    onChange={(e) =>
                      handleEntrustedPartyChange("phone", e.target.value)
                    }
                    placeholder="联系电话（选填）"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {verifyUploadCard}

        {/* 历史记录区域 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              历史记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  加载中...
                </span>
              </div>
            ) : historyRecords.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                暂无历史记录
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyRecords.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {record.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewHistory(record)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        查看
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteHistory(record.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default GeneratePage;
