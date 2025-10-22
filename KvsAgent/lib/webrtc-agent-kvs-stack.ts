import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';

export class WebrtcAgentKvsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC (Public Subnet only)
    const vpc = new ec2.Vpc(this, 'WebrtcKvsVpc', {
      maxAzs: 2,
      natGateways: 0, // Public Subnetのみなので不要
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // ECR Repository
    const repository = new ecr.Repository(this, 'WebrtcKvsRepository', {
      repositoryName: 'webrtc-agent-kvs-repo',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 開発用。本番ではRETAINを推奨
      emptyOnDelete: true,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'WebrtcKvsCluster', {
      vpc,
      clusterName: 'webrtc-kvs-cluster',
    });

    // Task Execution Role
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task Role (Fargateタスク内からKVSにアクセスするための権限)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // KVS Signaling Channel用の権限
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kinesisvideo:DescribeSignalingChannel',
        'kinesisvideo:GetSignalingChannelEndpoint',
        'kinesisvideo:GetIceServerConfig',
        'kinesisvideo:ConnectAsViewer',
      ],
      resources: [`arn:aws:kinesisvideo:${this.region}:${this.account}:channel/webrtc-kvs-agent-channel/*`],
    }));

    // KVS Stream用の権限
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kinesisvideo:PutMedia',
        'kinesisvideo:CreateStream',
        'kinesisvideo:DescribeStream',
        'kinesisvideo:GetDataEndpoint',
      ],
      resources: [`arn:aws:kinesisvideo:${this.region}:${this.account}:stream/webrtc-kvs-agent-stream/*`],
    }));

    // CloudWatch Logs
    const logGroup = new logs.LogGroup(this, 'WebrtcKvsLogGroup', {
      logGroupName: '/ecs/webrtc-kvs-agent',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WebrtcKvsTaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole,
      taskRole,
    });

    // Container Definition
    const container = taskDefinition.addContainer('WebrtcKvsContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'webrtc-kvs',
        logGroup,
      }),
      environment: {
        AWS_REGION: this.region,
      },
    });

    // Fargate Service
    const service = new ecs.FargateService(this, 'WebrtcKvsService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true, // Public Subnetなので必要
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // KVS Signaling Channel (Custom Resource)
    const signalingChannel = new cr.AwsCustomResource(this, 'KvsSignalingChannel', {
      onCreate: {
        service: 'KinesisVideo',
        action: 'createSignalingChannel',
        parameters: {
          ChannelName: 'webrtc-kvs-agent-channel',
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('ChannelARN'),
      },
      onDelete: {
        service: 'KinesisVideo',
        action: 'deleteSignalingChannel',
        parameters: {
          ChannelARN: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'kinesisvideo:CreateSignalingChannel',
            'kinesisvideo:DeleteSignalingChannel',
            'kinesisvideo:DescribeSignalingChannel',
          ],
          resources: ['*'],
        }),
      ]),
    });

    // KVS Stream (Custom Resource)
    const kvsStream = new cr.AwsCustomResource(this, 'KvsStream', {
      onCreate: {
        service: 'KinesisVideo',
        action: 'createStream',
        parameters: {
          StreamName: 'webrtc-kvs-agent-stream',
          DataRetentionInHours: 24,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('StreamARN'),
      },
      onDelete: {
        service: 'KinesisVideo',
        action: 'deleteStream',
        parameters: {
          StreamARN: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'kinesisvideo:CreateStream',
            'kinesisvideo:DeleteStream',
            'kinesisvideo:DescribeStream',
          ],
          resources: ['*'],
        }),
      ]),
    });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'SignalingChannelArn', {
      value: signalingChannel.getResponseField('ChannelARN'),
      description: 'KVS Signaling Channel ARN',
    });

    new cdk.CfnOutput(this, 'StreamArn', {
      value: kvsStream.getResponseField('StreamARN'),
      description: 'KVS Stream ARN',
    });
  }
}
