/**
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

import * as kinesisfirehose from '@aws-cdk/aws-kinesisfirehose';
import { Construct } from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as defaults from '@aws-solutions-constructs/core';
import * as iam from '@aws-cdk/aws-iam';
import { overrideProps } from '@aws-solutions-constructs/core';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';

/**
 * The properties for the KinesisFirehoseToS3 class.
 */
export interface KinesisFirehoseToS3Props {
    /**
     * Optional user provided props to override the default props
     *
     * @default - Default props are used
     */
    readonly kinesisFirehoseProps?: kinesisfirehose.CfnDeliveryStreamProps | any;
    /**
     * Existing instance of S3 Bucket object, if this is set then the bucketProps is ignored.
     *
     * @default - None
     */
    readonly existingBucketObj?: s3.Bucket,
    /**
     * User provided props to override the default props for the S3 Bucket.
     *
     * @default - Default props are used
     */
    readonly bucketProps?: s3.BucketProps
}

export class KinesisFirehoseToS3 extends Construct {
    public readonly kinesisFirehose: kinesisfirehose.CfnDeliveryStream;
    public readonly kinesisFirehoseRole: iam.Role;
    public readonly kinesisFirehoseLogGroup: logs.LogGroup;
    public readonly s3Bucket: s3.Bucket;
    public readonly s3LoggingBucket?: s3.Bucket;

    /**
     * Constructs a new instance of the IotToLambda class.
     */
    constructor(scope: Construct, id: string, props: KinesisFirehoseToS3Props) {
        super(scope, id);

        // Setup S3 Bucket
        [this.s3Bucket, this.s3LoggingBucket] = defaults.buildS3Bucket(this, {
            existingBucketObj: props.existingBucketObj,
            bucketProps: props.bucketProps
        });

        // Extract the CfnBucket from the s3Bucket
        const s3BucketResource = this.s3Bucket.node.findChild('Resource') as s3.CfnBucket;

        s3BucketResource.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W51',
                    reason: `This S3 bucket Bucket does not need a bucket policy`
                }]
            }
        };

        // Setup Cloudwatch Log group & stream for Kinesis Firehose
        this.kinesisFirehoseLogGroup = new logs.LogGroup(this, 'firehose-log-group', defaults.DefaultLogGroupProps());
        const cwLogStream: logs.LogStream = this.kinesisFirehoseLogGroup.addStream('firehose-log-stream');

        // Setup the IAM Role for Kinesis Firehose
        this.kinesisFirehoseRole = new iam.Role(this, 'KinesisFirehoseRole', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });

        // Setup the IAM policy for Kinesis Firehose
        const firehosePolicy = new iam.Policy(this, 'KinesisFirehosePolicy', {
            statements: [new iam.PolicyStatement({
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject'
              ],
              resources: [`${this.s3Bucket.bucketArn}`, `${this.s3Bucket.bucketArn}/*`]
            }),
            new iam.PolicyStatement({
                actions: [
                    'logs:PutLogEvents'
                ],
                resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:${this.kinesisFirehoseLogGroup.logGroupName}:log-stream:${cwLogStream.logStreamName}`]
            })
        ]});

        // Attach policy to role
        firehosePolicy.attachToRole(this.kinesisFirehoseRole);

        // Setup the default Kinesis Firehose props
        const defaultKinesisFirehoseProps: kinesisfirehose.CfnDeliveryStreamProps =
            defaults.DefaultCfnDeliveryStreamProps(this.s3Bucket.bucketArn, this.kinesisFirehoseRole.roleArn,
            this.kinesisFirehoseLogGroup.logGroupName, cwLogStream.logStreamName);

        // Override with the input props
        if (props.kinesisFirehoseProps) {
            const kinesisFirehoseProps = overrideProps(defaultKinesisFirehoseProps, props.kinesisFirehoseProps);
            this.kinesisFirehose = new kinesisfirehose.CfnDeliveryStream(this, 'KinesisFirehose', kinesisFirehoseProps);
        } else {
            this.kinesisFirehose = new kinesisfirehose.CfnDeliveryStream(this, 'KinesisFirehose', defaultKinesisFirehoseProps);
        }
    }
}