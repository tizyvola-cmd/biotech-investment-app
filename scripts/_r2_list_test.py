#!/usr/bin/env python3
import os
import boto3
from botocore.client import Config

c = boto3.client(
    "s3",
    endpoint_url=os.environ["SUPERNOVA_CDN_S3_ENDPOINT"],
    aws_access_key_id=os.environ["SUPERNOVA_CDN_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["SUPERNOVA_CDN_S3_SECRET_KEY"],
    config=Config(signature_version="s3v4"),
    region_name="auto",
)
r = c.list_objects_v2(Bucket="supernova-snapshots", MaxKeys=10)
print("count", r.get("KeyCount"))
for o in r.get("Contents") or []:
    print(repr(o["Key"]), o["Size"])
c.put_object(
    Bucket="supernova-snapshots",
    Key="ping.txt",
    Body=b"ok-supernova",
    ContentType="text/plain",
)
print("put ping.txt ok")
