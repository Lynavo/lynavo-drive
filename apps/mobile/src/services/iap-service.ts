import {
  initConnection,
  endConnection,
  purchaseUpdatedListener,
  purchaseErrorListener,
  requestSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { type EmitterSubscription } from 'react-native';
import { type IapProductId } from '../constants/iap';

export interface PurchaseReceipt {
  transactionReceipt: string;
  productId: IapProductId;
  transactionId: string;
}

export interface EligibilityResult {
  productId: IapProductId;
  eligibleForIntroOffer: boolean;
}

export interface IapService {
  initialize(): Promise<void>;
  teardown(): Promise<void>;
  purchase(productId: IapProductId): Promise<PurchaseReceipt>;
  restore(): Promise<PurchaseReceipt[]>;
  finishTransaction(transactionId: string): Promise<void>;
  checkEligibility(): Promise<EligibilityResult[]>;
  onOrphanPurchaseVerified(cb: () => void): () => void;
}

class IapServiceImpl implements IapService {
  private initialized = false;
  private purchaseSub: EmitterSubscription | null = null;
  private errorSub: EmitterSubscription | null = null;
  private pendingPurchase = new Map<
    IapProductId,
    {
      resolve: (r: PurchaseReceipt) => void;
      reject: (err: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await initConnection();
    this.purchaseSub = purchaseUpdatedListener((p) => {
      void this.handlePurchaseEvent(p);
    });
    this.errorSub = purchaseErrorListener((err) => {
      this.handleErrorEvent(err);
    });
    this.initialized = true;
  }

  async teardown(): Promise<void> {
    if (!this.initialized) return;
    this.purchaseSub?.remove();
    this.errorSub?.remove();
    this.purchaseSub = null;
    this.errorSub = null;
    await endConnection();
    this.initialized = false;
  }

  async purchase(productId: IapProductId): Promise<PurchaseReceipt> {
    if (!this.initialized) {
      throw new Error('iapService.initialize() must be called before purchase()');
    }
    if (this.pendingPurchase.has(productId)) {
      throw new Error(`purchase already in flight for ${productId}`);
    }
    return new Promise<PurchaseReceipt>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPurchase.delete(productId);
        reject(new Error('purchase timed out after 60s'));
      }, 60_000);
      this.pendingPurchase.set(productId, { resolve, reject, timeout });
      void Promise.resolve(requestSubscription({ sku: productId })).catch((err) => {
        const entry = this.pendingPurchase.get(productId);
        if (!entry) return;
        clearTimeout(entry.timeout);
        this.pendingPurchase.delete(productId);
        reject(err);
      });
    });
  }

  async restore(): Promise<PurchaseReceipt[]> {
    throw new Error('restore() not implemented yet');
  }
  async finishTransaction(_transactionId: string): Promise<void> {
    throw new Error('finishTransaction() not implemented yet');
  }
  async checkEligibility(): Promise<EligibilityResult[]> {
    throw new Error('checkEligibility() not implemented yet');
  }
  onOrphanPurchaseVerified(_cb: () => void): () => void {
    throw new Error('onOrphanPurchaseVerified() not implemented yet');
  }

  private async handlePurchaseEvent(p: Purchase): Promise<void> {
    const productId = p.productId as IapProductId;
    const pending = this.pendingPurchase.get(productId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPurchase.delete(productId);
      pending.resolve({
        productId,
        transactionReceipt: p.transactionReceipt,
        transactionId: p.transactionId ?? '',
      });
      return;
    }
    // Orphan — Task 6 handles this.
    await this.handleOrphanPurchase(p);
  }

  private handleErrorEvent(err: PurchaseError): void {
    const productId = err.productId as IapProductId | undefined;
    if (!productId) return;
    const pending = this.pendingPurchase.get(productId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingPurchase.delete(productId);
    pending.reject(err);
  }

  private async handleOrphanPurchase(_p: Purchase): Promise<void> {
    // Filled in by Task 6.
  }
}

export const iapService: IapService = new IapServiceImpl();
