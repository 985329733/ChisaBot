-- 所有机器人都是私有（2026-10-14，DESIGN.md §46）：把用户自己建的公开机器人改成私有，什么都不删。
-- 部署包自带的机器人（owner_user_id 为空）不动：它们没有主人，私有就只剩管理员能用。
UPDATE "agent_profiles" SET "visibility" = 'private', "updated_at" = now() WHERE "owner_user_id" IS NOT NULL AND "visibility" = 'public';
