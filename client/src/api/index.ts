import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import axios, { type AxiosRequestConfig } from 'axios';
import type {
  RecordListResp,
  RecordListParams,
  RecordDetailResp,
  RecentRecordsResp,
  UpdateRecordReq,
  UpdateRecordResp,
  OcrResp,
  SaveAuditReq,
  SaveAuditResp,
  VerifyReq,
  VerifyResp,
  ExtractResp,
  SaveGenerateReq,
  SaveGenerateResp,
  BuildLabelReq,
  BuildLabelResp,
  ImageDocumentCompareResp,
  ManufacturerExtractResp,
} from '@shared/api.interface';

const isLocalRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);

function backendRequest(config: AxiosRequestConfig) {
  if (isLocalRuntime) {
    return axios({
      ...config,
      url: config.url,
      baseURL: window.location.origin,
    });
  }
  return axiosForBackend(config);
}

// ==================== 记录管理 API ====================
export async function getRecords(params?: RecordListParams): Promise<RecordListResp> {
  try {
    const response = await backendRequest({
      url: '/api/records',
      method: 'GET',
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('获取记录列表失败', error);
    throw error;
  }
}

export async function getRecentRecords(): Promise<RecentRecordsResp> {
  try {
    const response = await backendRequest({
      url: '/api/records/recent',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取最近记录失败', error);
    throw error;
  }
}

export async function getRecordById(id: string): Promise<RecordDetailResp> {
  try {
    const response = await backendRequest({
      url: `/api/records/${id}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取记录详情失败', error);
    throw error;
  }
}

export async function updateRecord(id: string, data: UpdateRecordReq): Promise<UpdateRecordResp> {
  try {
    const response = await backendRequest({
      url: `/api/records/${id}`,
      method: 'PUT',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('更新记录失败', error);
    throw error;
  }
}

export async function deleteRecord(id: string): Promise<{ success: boolean }> {
  try {
    const response = await backendRequest({
      url: `/api/records/${id}`,
      method: 'DELETE',
    });
    return response.data;
  } catch (error) {
    logger.error('删除记录失败', error);
    throw error;
  }
}

export async function exportRecord(id: string): Promise<Blob> {
  try {
    const response = await backendRequest({
      url: `/api/records/${id}/export`,
      method: 'GET',
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出记录失败', error);
    throw error;
  }
}

// ==================== 标签审核 API ====================

// 压缩图片
function compressImage(file: File, maxWidth: number = 1920, maxHeight: number = 1920, quality: number = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let width = img.width;
      let height = img.height;

      // 计算缩放比例
      if (width > maxWidth || height > maxHeight) {
        const scale = Math.min(maxWidth / width, maxHeight / height);
        width *= scale;
        height *= scale;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };

    img.src = url;
  });
}

export async function ocrRecognize(file: File, signal?: AbortSignal): Promise<OcrResp> {
  try {
    // 压缩图片后再上传
    const imageBase64 = await compressImage(file, 4096, 4096, 0.95);
    const response = await backendRequest({
      url: '/api/audit/ocr',
      method: 'POST',
      data: {
        imageBase64,
        fileName: file.name,
      },
      timeout: 300000, // 多产品大图会多轮识别，本地测试给 5 分钟
      signal,
    });
    return response.data;
  } catch (error) {
    logger.error('OCR识别失败', error);
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    if (err.response?.data?.message) {
      throw new Error(err.response.data.message);
    }
    throw error;
  }
}

export async function compareImageWithDocument(params: {
  foodImage: File;
  nutritionImage?: File | null;
  manufacturerImage?: File | null;
  document: File;
}): Promise<ImageDocumentCompareResp> {
  try {
    const [foodImageBase64, nutritionImageBase64, manufacturerImageBase64, fileData] = await Promise.all([
      compressImage(params.foodImage, 4096, 4096, 0.95),
      params.nutritionImage ? compressImage(params.nutritionImage, 4096, 4096, 0.95) : Promise.resolve(undefined),
      params.manufacturerImage ? compressImage(params.manufacturerImage, 4096, 4096, 0.95) : Promise.resolve(undefined),
      fileToBase64(params.document),
    ]);

    const response = await backendRequest({
      url: '/api/audit/compare-file',
      method: 'POST',
      data: {
        foodImageBase64,
        foodImageFileName: params.foodImage.name,
        nutritionImageBase64,
        nutritionImageFileName: params.nutritionImage?.name,
        manufacturerImageBase64,
        manufacturerImageFileName: params.manufacturerImage?.name,
        fileName: params.document.name,
        fileType: params.document.type,
        fileData,
      },
      timeout: 300000,
    });
    return response.data as ImageDocumentCompareResp;
  } catch (error) {
    logger.error('图片与文件核对失败', error);
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    if (err.response?.data?.message) {
      throw new Error(err.response.data.message);
    }
    throw error;
  }
}

export async function extractManufacturerFromImage(file: File): Promise<ManufacturerExtractResp> {
  try {
    const imageBase64 = await compressImage(file, 4096, 4096, 0.95);
    const response = await backendRequest({
      url: '/api/audit/extract-manufacturer',
      method: 'POST',
      data: {
        imageBase64,
        fileName: file.name,
      },
      timeout: 300000,
    });
    return response.data as ManufacturerExtractResp;
  } catch (error) {
    logger.error('厂商信息识别失败', error);
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    if (err.response?.data?.message) {
      throw new Error(err.response.data.message);
    }
    throw error;
  }
}

export async function saveAudit(data: SaveAuditReq): Promise<SaveAuditResp> {
  try {
    const response = await backendRequest({
      url: '/api/audit/save',
      method: 'POST',
      data: {
        recordId: data.recordId,
        manufacturerInfo: data.manufacturerInfo,
        foodInfo: data.foodInfo,
      },
    });
    return response.data;
  } catch (error) {
    logger.error('保存审核数据失败', error);
    throw error;
  }
}

export async function verifyLabel(data: VerifyReq): Promise<VerifyResp> {
  try {
    const response = await backendRequest({
      url: '/api/audit/verify',
      method: 'POST',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('审核标签失败', error);
    throw error;
  }
}

export async function exportAuditReport(id: string): Promise<Blob> {
  try {
    const response = await backendRequest({
      url: `/api/audit/${id}/export`,
      method: 'GET',
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出审核报告失败', error);
    throw error;
  }
}

// ==================== 标签生成 API ====================
function getCsrfToken(): string | null {
  const match = document.cookie.match(/suda-csrf-token=([^;]+)/);
  return match ? match[1] : null;
}

function uploadWithXHR(url: string, formData: FormData): Promise<{ data: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // 使用完整路径，包含应用前缀
    const fullUrl = `${window.location.origin}/app/app_4jzs2z22tmfzz${url}`;
    xhr.open('POST', fullUrl, true);
    
    // 添加 CSRF token 头部
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      xhr.setRequestHeader('x-suda-csrf-token', csrfToken);
    }
    
    // 不设置 Content-Type，让浏览器自动处理 multipart boundary
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve({ data });
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.message || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;
        const base64Data = arrayBufferToBase64(arrayBuffer);
        resolve(base64Data);
      } catch (err) {
        reject(new Error('文件 Base64 编码失败'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    // 使用 readAsArrayBuffer 读取原始二进制数据，避免浏览器对 .doc 文件的 HTML 解析
    reader.readAsArrayBuffer(file);
  });
}

export async function extractFromDocument(file: File, keyword?: string): Promise<ExtractResp> {
  try {
    // 将文件转为 Base64，通过 JSON 传输，绕过 multipart 解析问题
    const base64Data = await fileToBase64(file);
    
    const response = await backendRequest({
      url: '/api/generate/extract',
      method: 'POST',
      data: {
        fileName: file.name,
        fileType: file.type,
        fileData: base64Data,
        keyword: keyword || undefined,
      },
    });
    return response.data as ExtractResp;
  } catch (error) {
    logger.error('文档提取失败', error);
    throw error;
  }
}

export async function saveGenerate(data: SaveGenerateReq): Promise<SaveGenerateResp> {
  try {
    const response = await backendRequest({
      url: '/api/generate/save',
      method: 'POST',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('保存生成数据失败', error);
    throw error;
  }
}

export async function buildLabel(data: BuildLabelReq): Promise<BuildLabelResp> {
  try {
    const response = await backendRequest({
      url: '/api/generate/build',
      method: 'POST',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('生成标签失败', error);
    throw error;
  }
}

export async function exportLabel(id: string): Promise<Blob> {
  try {
    const response = await backendRequest({
      url: `/api/generate/${id}/export`,
      method: 'GET',
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    logger.error('导出标签失败', error);
    throw error;
  }
}
