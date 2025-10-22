#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WebrtcAgentKvsStack } from '../lib/webrtc-agent-kvs-stack';

const app = new cdk.App();
new WebrtcAgentKvsStack(app, 'webrtc-agent-kvs-stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
  description: 'WebRTC KVS Agent Stack - Fargate service for streaming WebRTC to Kinesis Video Streams',
});