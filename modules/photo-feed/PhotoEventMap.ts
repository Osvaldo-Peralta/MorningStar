import { PhotoAddedPayload, PhotoEditedPayload, PhotoRemovedPayload } from "./events";

export interface PhotoEventMap {
    'photo:added': PhotoAddedPayload;
    'photo:edited': PhotoEditedPayload;
    'photo:removed': PhotoRemovedPayload;
}