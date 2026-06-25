/**
 * Stub ContentService for KEY Cortex integration safety pass.
 *
 * The original commit referenced a non-existent `content` domain module.
 * This stub preserves compilation while clearly marking content capabilities
 * as not yet wired. It should be replaced with the real content-ops module
 * integration once the domain surface is finalized.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class ContentService {
  private notImplemented(action: string): never {
    throw new Error(
      `Content action "${action}" is not wired in this build. ` +
        'Wire content-ops module integration before enabling.',
    );
  }

  async createPost(..._args: unknown[]) {
    this.notImplemented('createPost');
  }
  async schedulePost(..._args: unknown[]) {
    this.notImplemented('schedulePost');
  }
  async publishPost(..._args: unknown[]) {
    this.notImplemented('publishPost');
  }
  async createCampaign(..._args: unknown[]) {
    this.notImplemented('createCampaign');
  }
  async sendCampaign(..._args: unknown[]) {
    this.notImplemented('sendCampaign');
  }
  async generateContent(..._args: unknown[]) {
    this.notImplemented('generateContent');
  }
  async updatePost(..._args: unknown[]) {
    this.notImplemented('updatePost');
  }
  async deletePost(..._args: unknown[]) {
    this.notImplemented('deletePost');
  }
  async connectSocialAccount(..._args: unknown[]) {
    this.notImplemented('connectSocialAccount');
  }
  async disconnectSocialAccount(..._args: unknown[]) {
    this.notImplemented('disconnectSocialAccount');
  }
  async scheduleSocialPost(..._args: unknown[]) {
    this.notImplemented('scheduleSocialPost');
  }
  async publishSocialNow(..._args: unknown[]) {
    this.notImplemented('publishSocialNow');
  }
  async replyToSocialComment(..._args: unknown[]) {
    this.notImplemented('replyToSocialComment');
  }
  async deleteSocialPost(..._args: unknown[]) {
    this.notImplemented('deleteSocialPost');
  }
  async getDrafts(..._args: unknown[]) {
    return [];
  }
  async getScheduledPosts(..._args: unknown[]) {
    return [];
  }
}
